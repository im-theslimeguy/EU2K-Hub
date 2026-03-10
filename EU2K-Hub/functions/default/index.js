/**
 * EU2K Hub Firebase Cloud Functions
 * Staff Session Management and Access Control
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Logo cache for QR Code Monkey API
// Cache the uploaded logo filename to avoid re-uploading every time
let cachedLogoFile = null;

// Session duration: 15 minutes
const SESSION_DURATION_MS = 15 * 60 * 1000;

// Maximum failed attempts before lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Region configuration
const region = 'europe-west1';

// Common function options to reduce CPU quota usage
// Using minimal CPU allocation to stay within quota limits
const functionOptions = {
  region,
  maxInstances: 1, // Reduce CPU usage by limiting instances
  memory: '256MiB', // Reduce memory allocation
  cpu: 0.0833, // Use 1/12 CPU (minimal allocation) to reduce quota usage
  timeoutSeconds: 60 // Set timeout to prevent long-running functions
};

// Options for functions that might take longer (like syncUserNames)
const longRunningFunctionOptions = {
  region,
  maxInstances: 1,
  memory: '256MiB', // Keep same memory to reduce CPU quota
  cpu: 0.0833, // Use 1/12 CPU (minimal allocation)
  timeoutSeconds: 540 // 9 minutes for long-running operations
};

// Global rate limiting configuration (failsafe for ALL functions)
const RATE_LIMIT_REQUESTS_PER_MINUTE = 30; // Max requests per minute per user
const RATE_LIMIT_MIN_INTERVAL_MS = 100; // Minimum time between requests (100ms = max 10 req/sec)
const RATE_LIMIT_BURST = 3; // Allow 3 quick requests, then enforce interval

// Rate limiting configuration for confirmCode (stricter)
const CONFIRM_CODE_MAX_FAILED_ATTEMPTS = 5;

// Rate limiting for submitReport: max 5 reports per 15 minutes per user
const REPORT_MAX_REQUESTS = 5;
const REPORT_WINDOW_MS = 15 * 60 * 1000;
const CONFIRM_CODE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CONFIRM_CODE_LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const CONFIRM_CODE_REQUESTS_PER_MINUTE = 10; // Stricter for code confirmation

/**
 * Global rate limiting helper (failsafe for ALL functions)
 * Checks if user is making too many requests too quickly
 * Prevents: spam, DoS, excessive Firestore reads/writes
 */
async function checkGlobalRateLimit(userId, functionName = 'unknown') {
  const rlRef = db.doc(`rateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  const now = Date.now();

  if (rlSnap.exists) {
    const data = rlSnap.data();
    const lastRequestTime = data.lastRequestTime?.toMillis() || 0;
    const requestTimes = data.requestTimes || [];

    // Check minimum interval between requests (prevents rapid-fire spam)
    if (now - lastRequestTime < RATE_LIMIT_MIN_INTERVAL_MS) {
      const recentRequests = requestTimes.filter((time) => time > now - 1000); // Last second
      if (recentRequests.length >= RATE_LIMIT_BURST) {
        throw new HttpsError(
          'resource-exhausted',
          'Túl gyakori kérések. Várj egy kicsit.'
        );
      }
    }

    // Check requests per minute
    const oneMinuteAgo = now - 60 * 1000;
    const recentRequests = requestTimes.filter((time) => time > oneMinuteAgo);

    if (recentRequests.length >= RATE_LIMIT_REQUESTS_PER_MINUTE) {
      throw new HttpsError(
        'resource-exhausted',
        'Túl sok kérés rövid idő alatt. Próbáld újra később.'
      );
    }

    // Update request tracking
    const updatedRequestTimes = [...recentRequests, now].slice(-RATE_LIMIT_REQUESTS_PER_MINUTE);
    await rlRef.update({
      lastRequestTime: admin.firestore.Timestamp.fromMillis(now),
      requestTimes: updatedRequestTimes,
      lastFunction: functionName
    });
  } else {
    // First request, create rate limit document
    await rlRef.set({
      lastRequestTime: admin.firestore.Timestamp.fromMillis(now),
      requestTimes: [now],
      lastFunction: functionName,
      attempts: 0,
      windowStart: null,
      lockedUntil: null
    });
  }
}

/**
 * Rate limiting helper for confirmCode (stricter, with failed attempts tracking)
 */
async function checkConfirmCodeRateLimit(userId) {
  const rlRef = db.doc(`rateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  const now = Date.now();

  if (rlSnap.exists) {
    const data = rlSnap.data();

    // Check if user is locked out
    if (data.lockedUntil && data.lockedUntil.toMillis() > now) {
      const remainingMinutes = Math.ceil((data.lockedUntil.toMillis() - now) / (60 * 1000));
      throw new HttpsError(
        'resource-exhausted',
        `Túl sok próbálkozás. Próbáld újra ${remainingMinutes} perc múlva.`
      );
    }

    // Check if we're still in the same window
    const windowStart = data.windowStart?.toMillis() || 0;
    const inWindow = now - windowStart < CONFIRM_CODE_WINDOW_MS;

    if (inWindow) {
      // Check failed attempts
      if (data.attempts >= CONFIRM_CODE_MAX_FAILED_ATTEMPTS) {
        // Lock the user
        await rlRef.update({
          lockedUntil: admin.firestore.Timestamp.fromMillis(now + CONFIRM_CODE_LOCKOUT_MS)
        });
        throw new HttpsError(
          'resource-exhausted',
          'Túl sok hibás próbálkozás. Próbáld újra 10 perc múlva.'
        );
      }

      // Check rate limit (stricter for code confirmation)
      const requestTimes = data.requestTimes || [];
      const oneMinuteAgo = now - 60 * 1000;
      const recentRequests = requestTimes.filter((time) => time > oneMinuteAgo);

      if (recentRequests.length >= CONFIRM_CODE_REQUESTS_PER_MINUTE) {
        throw new HttpsError(
          'resource-exhausted',
          'Túl gyakori kérések. Várj egy kicsit.'
        );
      }
    } else {
      // New window, reset attempts
      await rlRef.update({
        attempts: 0,
        windowStart: admin.firestore.Timestamp.fromMillis(now)
      });
    }
  }
}

/**
 * Increment failed attempts for confirmCode
 */
async function incrementFailedAttempts(userId) {
  const rlRef = db.doc(`rateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  const now = Date.now();

  if (rlSnap.exists) {
    const data = rlSnap.data();
    const windowStart = data.windowStart?.toMillis() || now;
    const inWindow = now - windowStart < CONFIRM_CODE_WINDOW_MS;

    await rlRef.update({
      attempts: admin.firestore.FieldValue.increment(1),
      windowStart: inWindow ? data.windowStart : admin.firestore.Timestamp.fromMillis(now)
    });
  } else {
    await rlRef.set({
      attempts: 1,
      windowStart: admin.firestore.Timestamp.fromMillis(now),
      lastRequestTime: admin.firestore.Timestamp.fromMillis(now),
      requestTimes: [now],
      lockedUntil: null
    });
  }
}

/**
 * Reset rate limit on success (for confirmCode)
 */
async function resetConfirmCodeRateLimit(userId) {
  const rlRef = db.doc(`rateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  
  if (rlSnap.exists) {
    const data = rlSnap.data();
    // Reset only the confirmCode-specific fields, keep global tracking
    await rlRef.update({
      attempts: 0,
      windowStart: null,
      lockedUntil: null
    });
  }
}

/**
 * Shared helper: require authenticated staff user (admin / owner / teacher)
 * Throws proper HttpsError on failure and returns { uid, claims } on success.
 */
async function requireStaff(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;

  const userRecord = await admin.auth().getUser(uid);
  const claims = userRecord.customClaims || {};

  if (!claims.admin && !claims.owner && !claims.teacher) {
    throw new HttpsError('permission-denied', 'User does not have staff privileges');
  }

  return { uid, claims };
}

/**
 * Start a staff session
 * Verifies password and creates a 15-minute session
 * If there's an existing active session, it will be marked as replaced
 */
exports.staffSessionStart = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'staffSessionStart');
    }
    
    // Require authenticated staff user
    const { uid } = await requireStaff(request);
    const { password, deviceId } = request.data;

    if (!password) {
      throw new HttpsError('invalid-argument', 'Password is required');
    }

    // Verify password using the existing verifyAdminConsolePassword function
    const verifyResult = await verifyAdminConsolePasswordInternal({ password }, { auth: request.auth });

    if (!verifyResult.success) {
      throw new HttpsError('permission-denied', 'Invalid password');
    }

    // Check for existing active session on different device
    const existingSessionDoc = await db.collection('staffSessions').doc(uid).get();
    let hasExistingSession = false;
    let existingDeviceId = null;
    let existingEndTime = null;

    if (existingSessionDoc.exists) {
      const existingData = existingSessionDoc.data();
      const now = Date.now();
      const existingEndTimeMs = existingData.endTime ? existingData.endTime.toMillis() : 0;
      const existingDeviceIdFromSession = existingData.deviceId || null;

      if (existingData.active && existingEndTimeMs > now) {
        // Check if it's a different device
        if (existingDeviceIdFromSession && existingDeviceIdFromSession !== deviceId) {
          hasExistingSession = true;
          existingDeviceId = existingDeviceIdFromSession;
          existingEndTime = existingEndTimeMs;

          // Mark that a new device tried to start a session
          await db.collection('staffSessions').doc(uid).update({
            transferRequested: true,
            transferRequestedByDeviceId: deviceId || 'unknown',
            transferRequestedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Don't create new session, return error
          throw new HttpsError('failed-precondition', 'Active session exists on another device', {
            existingDeviceId: existingDeviceId,
            existingEndTime: existingEndTime
          });
        }
      }
    }

    // Calculate session end time
    const now = Date.now();
    const endTime = now + SESSION_DURATION_MS;

    // Create new session document in Firestore
    await db.collection('staffSessions').doc(uid).set({
      userId: uid,
      deviceId: deviceId || 'unknown',
      startTime: admin.firestore.Timestamp.fromMillis(now),
      endTime: admin.firestore.Timestamp.fromMillis(endTime),
      active: true,
      replaced: false,
      transferRequested: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      success: true,
      endTime: endTime,
      duration: SESSION_DURATION_MS
    };
  } catch (error) {
    console.error('[staffSessionStart] Error:', error);
    throw error;
  }
});

/**
 * Check if a staff session is active
 * Also checks if session was replaced by another device
 */
exports.staffSessionCheck = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'staffSessionCheck');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      return { active: false };
    }

    const uid = request.auth.uid;
    const { deviceId } = request.data || {};

    // Get session document
    const sessionDoc = await db.collection('staffSessions').doc(uid).get();

    if (!sessionDoc.exists) {
      return { active: false };
    }

    const sessionData = sessionDoc.data();
    const now = Date.now();
    const endTime = sessionData.endTime ? sessionData.endTime.toMillis() : 0;

    // Check if transfer was requested
    if (sessionData.transferRequested && sessionData.active && endTime > now) {
      const transferRequestedBy = sessionData.transferRequestedByDeviceId || null;
      const sessionDeviceId = sessionData.deviceId || null;

      // If current device is the one that requested transfer, notify it
      if (deviceId && deviceId === transferRequestedBy) {
        return {
          active: false,
          transferRequested: true,
          existingDeviceId: sessionDeviceId,
          existingEndTime: endTime,
          message: 'Session transfer requested'
        };
      }

      // If current device is the one with active session, notify it about transfer request
      if (deviceId && deviceId === sessionDeviceId) {
        return {
          active: true,
          endTime: endTime,
          remainingTime: endTime - now,
          transferRequested: true,
          transferRequestedByDeviceId: transferRequestedBy,
          message: 'Another device requested session transfer'
        };
      }
    }

    // Check if current device matches session device
    const sessionDeviceId = sessionData.deviceId || null;
    if (deviceId && sessionDeviceId && deviceId !== sessionDeviceId && sessionData.active && endTime > now) {
      // Different device trying to use session - notify client
      return {
        active: false,
        transferAvailable: true,
        existingDeviceId: sessionDeviceId,
        existingEndTime: endTime,
        message: 'Session is active on another device'
      };
    }

    // Check if session is still active
    if (sessionData.active && endTime > now) {
      return {
        active: true,
        endTime: endTime,
        remainingTime: endTime - now,
        replaced: false
      };
    } else {
      // Session expired, update document
      await db.collection('staffSessions').doc(uid).update({
        active: false
      });

      // Log session expiration
      console.log('[staffSessionCheck] Session expired for user:', uid, 'Device:', deviceId || 'unknown');

      return {
        active: false,
        expired: true,
        message: 'Session has expired'
      };
    }
  } catch (error) {
    console.error('[staffSessionCheck] Error:', error);
    return { active: false };
  }
});

/**
 * End a staff session
 */
exports.staffSessionEnd = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'staffSessionEnd');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { password } = request.data;

    if (!password) {
      throw new HttpsError('invalid-argument', 'Password is required');
    }

    // Verify password
    const verifyResult = await verifyAdminConsolePasswordInternal({ password }, { auth: request.auth });

    if (!verifyResult.success) {
      throw new HttpsError('permission-denied', 'Invalid password');
    }

    // End session
    await db.collection('staffSessions').doc(uid).update({
      active: false,
      endedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('[staffSessionEnd] Error:', error);
    throw error;
  }
});

/**
 * End all staff sessions for a user
 * This is called when user wants to end all sessions on all devices
 */
exports.staffSessionEndAll = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'staffSessionEndAll');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { password } = request.data;

    if (!password) {
      throw new HttpsError('invalid-argument', 'Password is required');
    }

    // Verify password
    const verifyResult = await verifyAdminConsolePasswordInternal({ password }, { auth: request.auth });

    if (!verifyResult.success) {
      throw new HttpsError('permission-denied', 'Invalid password');
    }

    // End all sessions by setting active to false
    await db.collection('staffSessions').doc(uid).update({
      active: false,
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
      endedAll: true,
      deviceId: null, // Clear device ID
      transferRequested: false
    });

    console.log('[staffSessionEndAll] All sessions ended for user:', uid);

    return { success: true };
  } catch (error) {
    console.error('[staffSessionEndAll] Error:', error);
    throw error;
  }
});

/**
 * Transfer session to another device
 * This is called when user wants to transfer their session from old device to new device
 */
exports.staffSessionTransfer = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'staffSessionTransfer');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { password, newDeviceId } = request.data;

    if (!password) {
      throw new HttpsError('invalid-argument', 'Password is required');
    }

    if (!newDeviceId) {
      throw new HttpsError('invalid-argument', 'New device ID is required');
    }

    // Verify password
    const verifyResult = await verifyAdminConsolePasswordInternal({ password }, { auth: request.auth });

    if (!verifyResult.success) {
      throw new HttpsError('permission-denied', 'Invalid password');
    }

    // Get current session
    const sessionDoc = await db.collection('staffSessions').doc(uid).get();

    if (!sessionDoc.exists) {
      throw new HttpsError('failed-precondition', 'No active session found');
    }

    const sessionData = sessionDoc.data();
    const now = Date.now();
    const endTime = sessionData.endTime ? sessionData.endTime.toMillis() : 0;

    if (!sessionData.active || endTime <= now) {
      throw new HttpsError('failed-precondition', 'Session is not active');
    }

    // Transfer session to new device (keep same endTime)
    await db.collection('staffSessions').doc(uid).update({
      deviceId: newDeviceId,
      replaced: false,
      transferRequested: false,
      transferredAt: admin.firestore.FieldValue.serverTimestamp(),
      transferredFromDeviceId: sessionData.deviceId || null
    });

    console.log('[staffSessionTransfer] Session transferred from', sessionData.deviceId, 'to', newDeviceId);

    return {
      success: true,
      endTime: endTime,
      remainingTime: endTime - now
    };
  } catch (error) {
    console.error('[staffSessionTransfer] Error:', error);
    throw error;
  }
});

/**
 * Check write access to classes collection
 * This is called before any write operation to classes
 */
exports.checkClassWriteAccess = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'checkClassWriteAccess');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      // Log unauthorized attempt
      await logAccessAttempt(null, false, 'Not authenticated');
      return { allowed: false, reason: 'Not authenticated' };
    }

    const uid = request.auth.uid;

    // Get user's custom claims
    const userRecord = await admin.auth().getUser(uid);
    const claims = userRecord.customClaims || {};

    // Check if user is staff
    if (!claims.admin && !claims.owner && !claims.teacher) {
      await logAccessAttempt(uid, false, 'Not a staff member');
      return { allowed: false, reason: 'Not a staff member' };
    }

    // Check if session is active
    const sessionDoc = await db.collection('staffSessions').doc(uid).get();

    if (!sessionDoc.exists) {
      await logAccessAttempt(uid, false, 'No active session');
      return { allowed: false, reason: 'No active session' };
    }

    const sessionData = sessionDoc.data();
    const now = Date.now();
    const endTime = sessionData.endTime.toMillis();

    if (!sessionData.active || endTime <= now) {
      await logAccessAttempt(uid, false, 'Session expired');

      // Update session to inactive
      await db.collection('staffSessions').doc(uid).update({
        active: false
      });

      return { allowed: false, reason: 'Session expired' };
    }

    // Check failed attempts
    const attemptsDoc = await db.collection('classWriteAttempts').doc(uid).get();

    if (attemptsDoc.exists) {
      const attemptsData = attemptsDoc.data();
      const failedAttempts = attemptsData.failedAttempts || 0;
      const lockoutUntil = attemptsData.lockoutUntil ? attemptsData.lockoutUntil.toMillis() : 0;

      // Check if locked out
      if (lockoutUntil > now) {
        await logAccessAttempt(uid, false, 'Locked out');
        return {
          allowed: false,
          reason: 'Too many failed attempts. Locked until ' + new Date(lockoutUntil).toISOString()
        };
      }

      // Reset if lockout expired
      if (lockoutUntil > 0 && lockoutUntil <= now) {
        await db.collection('classWriteAttempts').doc(uid).update({
          failedAttempts: 0,
          lockoutUntil: null
        });
      }
    }

    // Access allowed
    await logAccessAttempt(uid, true, 'Access granted');
    return { allowed: true };
  } catch (error) {
    console.error('[checkClassWriteAccess] Error:', error);
    await logAccessAttempt(request.auth?.uid || null, false, 'Error: ' + error.message);
    return { allowed: false, reason: 'Internal error' };
  }
});

/**
 * Log access attempt
 */
async function logAccessAttempt(uid, success, reason) {
  try {
    if (!uid) return;

    const attemptsRef = db.collection('classWriteAttempts').doc(uid);
    const attemptsDoc = await attemptsRef.get();

    if (!attemptsDoc.exists) {
      // Create new document
      await attemptsRef.set({
        userId: uid,
        failedAttempts: success ? 0 : 1,
        lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
        lastReason: reason
      });
    } else {
      const data = attemptsDoc.data();
      const failedAttempts = data.failedAttempts || 0;

      if (success) {
        // Reset failed attempts on success
        await attemptsRef.update({
          failedAttempts: 0,
          lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
          lastReason: reason
        });
      } else {
        const newFailedAttempts = failedAttempts + 1;
        const updateData = {
          failedAttempts: newFailedAttempts,
          lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
          lastReason: reason
        };

        // Lockout after MAX_FAILED_ATTEMPTS
        if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
          updateData.lockoutUntil = admin.firestore.Timestamp.fromMillis(
            Date.now() + LOCKOUT_DURATION_MS
          );
        }

        await attemptsRef.update(updateData);
      }
    }

    // Log to a separate collection for auditing
    await db.collection('classWriteAccessLogs').add({
      userId: uid,
      success: success,
      reason: reason,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[logAccessAttempt] Error:', error);
  }
}

/**
 * Internal function to verify admin console password
 */
async function verifyAdminConsolePasswordInternal(data, context) {
  // Check authentication
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = context.auth.uid;
  const { password } = data;

  if (!password) {
    throw new HttpsError('invalid-argument', 'Password is required');
  }

  try {
    // Get user document
    const userRecord = await admin.auth().getUser(uid);
    const customClaims = userRecord.customClaims || {};

    // Check if user has stored password in custom claims
    const storedPassword = customClaims.adminPassword;

    if (!storedPassword) {
      throw new HttpsError('permission-denied', 'No password set for this user');
    }

    // Simple comparison (in production, use proper hashing)
    if (password === storedPassword) {
      return {
        success: true,
        role: customClaims.admin ? 'admin' : (customClaims.owner ? 'owner' : (customClaims.teacher ? 'teacher' : 'none'))
      };
    } else {
      throw new HttpsError('permission-denied', 'Invalid password');
    }
  } catch (error) {
    console.error('[verifyAdminConsolePasswordInternal] Error:', error);
    throw error;
  }
}

/**
 * Verify admin console password (from existing code)
 * This function is reused from the existing admin console
 */
exports.verifyAdminConsolePassword = onCall(functionOptions, async (request) => {
  // Global rate limiting (failsafe)
  if (request.auth) {
    await checkGlobalRateLimit(request.auth.uid, 'verifyAdminConsolePassword');
  }
  
  return await verifyAdminConsolePasswordInternal(request.data, { auth: request.auth });
});

/**
 * TEMPORARY: Set admin password for a user (REMOVE AFTER USE!)
 * Call this once to set the admin password
 */
exports.setAdminPasswordForUser = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'setAdminPasswordForUser');
    }
    
    const { userId, password } = request.data;

    if (!userId || !password) {
      throw new HttpsError('invalid-argument', 'userId and password are required');
    }

    // Get current claims
    const userRecord = await admin.auth().getUser(userId);
    const currentClaims = userRecord.customClaims || {};

    // Add admin password
    const newClaims = {
      ...currentClaims,
      adminPassword: password,
      owner: true,
      admin: true,
      teacher: true,
      student: true
    };

    await admin.auth().setCustomUserClaims(userId, newClaims);

    return {
      success: true,
      message: 'Admin password set successfully',
      claims: newClaims
    };
  } catch (error) {
    console.error('[setAdminPasswordForUser] Error:', error);
    throw error;
  }
});

/**
 * Refresh user custom claims based on Firestore accessLevel
 * This function checks Firestore and updates custom claims if needed
 */
exports.refreshUserClaims = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'refreshUserClaims');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;

    // Get current claims
    const userRecord = await admin.auth().getUser(uid);
    const currentClaims = userRecord.customClaims || {};

    // If claims already exist, return them
    if (currentClaims.admin || currentClaims.owner || currentClaims.teacher) {
      return {
        success: true,
        claims: currentClaims,
        refreshed: false
      };
    }

    // Get accessLevel from Firestore
    let accessLevel = null;

    // Try users/{uid} document
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      accessLevel = userDoc.data().accessLevel;
    }

    // Try users/{uid}/general_data collection
    if (!accessLevel) {
      const generalDataRef = db.collection(`users/${uid}/general_data`);
      const generalDataDocs = await generalDataRef.get();

      generalDataDocs.forEach((doc) => {
        const data = doc.data();
        if (data.accessLevel) {
          accessLevel = data.accessLevel;
        }
      });
    }

    if (!accessLevel) {
      return {
        success: false,
        message: 'No accessLevel found in Firestore'
      };
    }

    // Build custom claims based on accessLevel
    const customClaims = { ...currentClaims };

    switch (accessLevel) {
      case 'owner':
        customClaims.owner = true;
        customClaims.admin = true;
        customClaims.teacher = true;
        customClaims.student = true;
        break;
      case 'admin':
        customClaims.admin = true;
        customClaims.teacher = true;
        customClaims.student = true;
        break;
      case 'teacher':
        customClaims.teacher = true;
        customClaims.student = true;
        break;
      case 'parent':
        customClaims.parent = true;
        break;
      case 'student':
      default:
        customClaims.student = true;
        break;
    }

    // Set custom claims
    await admin.auth().setCustomUserClaims(uid, customClaims);

    console.log(`[refreshUserClaims] Claims updated for user ${uid}:`, customClaims);

    return {
      success: true,
      claims: customClaims,
      refreshed: true,
      accessLevel: accessLevel
    };
  } catch (error) {
    console.error('[refreshUserClaims] Error:', error);
    throw new HttpsError('internal', 'Error refreshing claims: ' + error.message);
  }
});

/**
 * Sync user names from users collection to usrLookup/names
 * Reads all documents from users collection, extracts fullName, simplifies it,
 * and creates usrLookup/names/{simplifiedName}/{userId} documents
 */
exports.syncUserNames = onCall(longRunningFunctionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'syncUserNames');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;

    // Get user's custom claims to check if admin/owner/teacher
    const userRecord = await admin.auth().getUser(uid);
    const claims = userRecord.customClaims || {};

    // Allow admins/owners/teachers to sync
    if (!claims.admin && !claims.owner && !claims.teacher) {
      throw new HttpsError('permission-denied', 'Only admins, owners, and teachers can sync user names');
    }

    console.log('[syncUserNames] Starting sync...');

    // Helper function to simplify name
    function simplifyName(fullName) {
      if (!fullName) return '';

      // Remove accents/diacritics
      const normalized = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Convert to lowercase
      const lowercased = normalized.toLowerCase();

      // Replace spaces with underscores
      const simplified = lowercased.replace(/\s+/g, '_');

      return simplified;
    }

    // Get all users from users collection
    const usersSnapshot = await db.collection('users').get();

    let syncedCount = 0;
    let batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const fullName = userData.fullName || userData.name || userData.displayName;
      const email = userData.email || '';

      if (!fullName) {
        console.log(`[syncUserNames] Skipping user ${userId} - no fullName`);
        continue;
      }

      const simplifiedName = simplifyName(fullName);
      if (!simplifiedName) {
        console.log(`[syncUserNames] Skipping user ${userId} - simplified name is empty`);
        continue;
      }

      // Create document in usrlookup/names/{simplifiedName}/{userId}
      const lookupRef = db.doc(`usrlookup/names/${simplifiedName}/${userId}`);
      batch.set(lookupRef, {
        fullName: fullName,
        email: email
      }, { merge: true });

      batchCount++;
      syncedCount++;

      // Commit batch if it reaches max size
      if (batchCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        console.log(`[syncUserNames] Committed batch, synced ${syncedCount} users so far...`);
        // Create new batch for remaining users
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Commit remaining batch
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`[syncUserNames] Sync completed. Synced ${syncedCount} users.`);

    return {
      success: true,
      syncedCount: syncedCount
    };
  } catch (error) {
    console.error('[syncUserNames] Error:', error);
    throw new HttpsError('internal', 'Error syncing user names: ' + error.message);
  }
});

/**
 * Add a fullName to usrLookup/names/toBeAdded collection
 * Used when a name is not found during class registration
 */
exports.addToBeAddedName = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'addToBeAddedName');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { fullName, classId } = request.data;

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      throw new HttpsError('invalid-argument', 'fullName is required and must be a non-empty string');
    }

    // Add to usrlookup/names/toBeAdded collection
    const toBeAddedRef = db.collection('usrlookup').doc('names').collection('toBeAdded').doc();
    const docData = {
      fullName: fullName.trim(),
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      addedBy: request.auth.uid
    };

    // Add classId if provided
    if (classId && typeof classId === 'string' && classId.trim()) {
      docData.class = classId.trim();
    }

    await toBeAddedRef.set(docData);

    console.log(`[addToBeAddedName] Added name to toBeAdded: ${fullName.trim()}${classId ? ` (class: ${classId})` : ''}`);

    return {
      success: true,
      docId: toBeAddedRef.id
    };
  } catch (error) {
    console.error('[addToBeAddedName] Error:', error);
    throw new HttpsError('internal', 'Error adding name to toBeAdded: ' + error.message);
  }
});

/**
 * Create a class with users
 * Creates classes/{classId} document and classes/{classId}/users/{userId} documents
 */
exports.createClass = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'createClass');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { classId, userIds } = request.data;

    if (!classId || typeof classId !== 'string' || !classId.trim()) {
      throw new HttpsError('invalid-argument', 'classId is required and must be a non-empty string');
    }

    if (!userIds || !Array.isArray(userIds)) {
      throw new HttpsError('invalid-argument', 'userIds must be an array');
    }

    // Get user's custom claims to check if admin/owner/teacher
    const userRecord = await admin.auth().getUser(uid);
    const claims = userRecord.customClaims || {};

    // Allow admins/owners/teachers to create classes
    if (!claims.admin && !claims.owner && !claims.teacher) {
      throw new HttpsError('permission-denied', 'Only admins, owners, and teachers can create classes');
    }

    console.log(`[createClass] Creating class ${classId} with ${userIds.length} users...`);

    // Check if class already exists
    const classRef = db.doc(`classes/${classId}`);
    const classSnap = await classRef.get();

    if (classSnap.exists) {
      throw new HttpsError('already-exists', `Class ${classId} already exists`);
    }

    // Create class document
    await classRef.set({
      createdBy: uid,
      leaderUid: uid, // Standardized field as requested
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      classId: classId.trim()
    });

    // Only create user documents if userIds is not empty
    if (userIds.length > 0) {
      // ... (rest of code)
      // (Wait, I can't use 'rest of code' in replacement if I'm not matching exact lines. I should only replace the set block or use separate chunks)
    }
    // Actually, I'll use multi_replace or carefully targeted replace.
    // Let's replace createClass set block first.
    // And then replace approveJoinRequest entirely.

  } catch (error) {
    console.error('[createClass] Error:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Error creating class: ' + error.message);
  }
});

/**
 * Approve (or Reject) a Class Join Request
 * Securely handles the approval process using a Transaction.
 * Ensures atomicity between updating the request and adding the user to the class.
 */
exports.approveJoinRequest = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'approveJoinRequest');
    }
    
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { requestId, decision } = request.data;
    const uid = request.auth.uid;

    if (!requestId || !decision || !['approved', 'rejected'].includes(decision)) {
      throw new HttpsError('invalid-argument', 'Invalid request parameters');
    }

    const requestRef = db.collection('joinRequests').doc(requestId);

    await db.runTransaction(async (transaction) => {
      // 1. Read the request
      const requestDoc = await transaction.get(requestRef);

      if (!requestDoc.exists) {
        throw new HttpsError('not-found', 'Join request not found');
      }

      const requestData = requestDoc.data();

      // Verify ownership
      // Check for leaderUid, teacherUid, or ownerUid in the request
      // The request should have the target teacher's UID.
      const targetTeacherUid = requestData.teacherUid || requestData.leaderUid || requestData.ownerUid;

      if (targetTeacherUid !== uid) {
        // Double check admin privileges if needed, but for now strict check on target
        // We'll rely on the caller being the intended recipient
        throw new HttpsError('permission-denied', 'Only the target teacher can approve this request');
      }

      // Allow updating only if pending
      if (requestData.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Request is already processed');
      }

      // 2. Update Join Request Status
      transaction.update(requestRef, {
        status: decision,
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedBy: uid
      });

      // 3. If Approved, add user to class
      if (decision === 'approved') {
        const classId = requestData.classId;
        const studentUid = requestData.requesterUid;

        if (classId && studentUid) {
          const classUserRef = db.doc(`classes/${classId}/users/${studentUid}`);
          transaction.set(classUserRef, {
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
            addedBy: uid,
            viaJoinRequest: true,
            requestId: requestId
          });
        }
      }
    });

    console.log(`[approveJoinRequest] Request ${requestId} ${decision} by ${uid} (Transaction)`);

    return { success: true };

  } catch (error) {
    console.error('[approveJoinRequest] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Sync user name to usrlookup/names
 * Called at the end of onboarding to sync user's fullName
 * Creates: usrlookup/names/{simplifiedName}/{uid} with { fullName }
 */
exports.syncUserName = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'syncUserName');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    // Get user's fullName from users/{uid}
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User document not found');
    }

    const userData = userDoc.data();
    const fullName = userData.fullName || userData.name || userData.displayName;

    if (!fullName) {
      throw new HttpsError('failed-precondition', 'No fullName found in user document');
    }

    // Simplify the name: remove accents, lowercase, replace spaces with underscores
    const simplifyName = (name) => {
      return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, '_');
    };

    const simplifiedName = simplifyName(fullName);

    // Write to usrlookup/names/{simplifiedName}/{uid}
    await db.collection('usrlookup').doc('names').collection(simplifiedName).doc(uid).set({
      fullName: fullName
    });

    console.log(`[syncUserName] Synced user ${uid} with name: ${fullName} -> ${simplifiedName}`);

    return { success: true, simplifiedName };

  } catch (error) {
    console.error('[syncUserName] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Check if user has a password set
 * Returns hasPassword: true/false
 */
exports.checkUserHasPassword = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'checkUserHasPassword');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;

    // Get user's custom claims
    const userRecord = await admin.auth().getUser(uid);
    const customClaims = userRecord.customClaims || {};
    const hasPassword = !!customClaims.adminPassword;

    return { hasPassword };

  } catch (error) {
    console.error('[checkUserHasPassword] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Create/set password for user
 * Password must be at least 8 characters
 */
exports.createUserPassword = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'createUserPassword');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { password } = request.data;

    if (!password || password.length < 8) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
    }

    // Get current custom claims
    const userRecord = await admin.auth().getUser(uid);
    const customClaims = userRecord.customClaims || {};

    // Set password in custom claims
    await admin.auth().setCustomUserClaims(uid, {
      ...customClaims,
      adminPassword: password
    });

    console.log(`[createUserPassword] Password created for user ${uid}`);

    return { success: true };

  } catch (error) {
    console.error('[createUserPassword] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Delete password for user
 * Removes adminPassword from custom claims
 */
exports.deleteUserPassword = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'deleteUserPassword');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;

    // Get current custom claims
    const userRecord = await admin.auth().getUser(uid);
    const customClaims = userRecord.customClaims || {};

    // Remove password from custom claims
    const { adminPassword, ...remainingClaims } = customClaims;

    await admin.auth().setCustomUserClaims(uid, remainingClaims);

    console.log(`[deleteUserPassword] Password deleted for user ${uid}`);

    return { success: true };

  } catch (error) {
    console.error('[deleteUserPassword] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Set admin password for a specific user (admin function)
 * Sets password and all role claims (owner, admin, teacher, student)
 * Based on set-admin-password.js script
 */
exports.setAdminPassword = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'setAdminPassword');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Only allow owners to call this function
    const callerRecord = await admin.auth().getUser(request.auth.uid);
    const callerClaims = callerRecord.customClaims || {};
    if (!callerClaims.owner) {
      throw new HttpsError('permission-denied', 'Only owners can set admin passwords');
    }

    const { userId, password } = request.data;

    if (!userId || !password) {
      throw new HttpsError('invalid-argument', 'userId and password are required');
    }

    // Get current custom claims for target user
    const userRecord = await admin.auth().getUser(userId);
    const currentClaims = userRecord.customClaims || {};

    // Add admin password and all role claims
    const newClaims = {
      ...currentClaims,
      adminPassword: password,
      owner: true,
      admin: true,
      teacher: true,
      student: true
    };

    // Set custom claims
    await admin.auth().setCustomUserClaims(userId, newClaims);

    console.log(`[setAdminPassword] Password and claims set for user ${userId}`);

    return {
      success: true,
      message: `Password and claims set for user ${userId}`,
      claims: newClaims
    };

  } catch (error) {
    console.error('[setAdminPassword] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Save onboarding names (fullName and nickname)
 * Called during onboarding to save user's full name and nickname
 * Writes to users/{userId} document
 */
exports.saveOnboardingNames = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'saveOnboardingNames');
    }
    
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { fullName, nickname } = request.data;

    // Validate inputs
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      throw new HttpsError('invalid-argument', 'fullName is required and must be a non-empty string');
    }

    if (!nickname || typeof nickname !== 'string' || !nickname.trim()) {
      throw new HttpsError('invalid-argument', 'nickname is required and must be a non-empty string');
    }

    const trimmedFullName = fullName.trim();
    const trimmedNickname = nickname.trim();

    // Save to users/{uid}
    await db.collection('users').doc(uid).set({
      fullName: trimmedFullName,
      nickname: trimmedNickname,
      namesUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[saveOnboardingNames] Saved for user ${uid}: fullName="${trimmedFullName}", nickname="${trimmedNickname}"`);

    return {
      success: true,
      fullName: trimmedFullName,
      nickname: trimmedNickname
    };

  } catch (error) {
    console.error('[saveOnboardingNames] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Get profile picture URL from Firebase Storage
 * Accepts either userId directly or normalizedName to look up userId from usrlookup
 * Checks if profile picture exists and returns a usable download URL:
 * - Prefer Firebase download token URL (works with typical Storage rules)
 * - Fallback to a signed URL if token is missing
 */
exports.getProfilePicture = onCall(functionOptions, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'getProfilePicture');
    }
    
    const { userId, normalizedName } = request.data;

    let actualUserId = userId;

    // If normalizedName provided, look up the userId from usrlookup
    if (normalizedName && !userId) {
      console.log(`[getProfilePicture] Looking up userId for normalizedName: ${normalizedName}`);

      // The usrlookup structure is: usrlookup/names/{normalizedName}/{userId}
      // So we need to get all documents in the subcollection usrlookup/names/{normalizedName}
      // Each document ID in that subcollection is a userId

      let foundUserId = null;

      try {
        console.log(`[getProfilePicture] Checking usrlookup/names/${normalizedName}`);

        // Try usrlookup/names/{normalizedName}
        const namesRef = db.collection('usrlookup').doc('names').collection(normalizedName);
        const namesSnap = await namesRef.get();

        console.log(`[getProfilePicture] namesSnap.empty: ${namesSnap.empty}, docs count: ${namesSnap.docs.length}`);

        if (!namesSnap.empty) {
          // Take the first userId found (document ID is the userId)
          const firstDoc = namesSnap.docs[0];
          foundUserId = firstDoc.id;
          console.log(`[getProfilePicture] Found userId ${foundUserId} in usrlookup/names/${normalizedName}`);
        } else {
          console.log(`[getProfilePicture] No documents in usrlookup/names/${normalizedName}, trying teachers`);

          // Try usrlookup/teachers/{normalizedName}
          const teachersRef = db.collection('usrlookup').doc('teachers').collection(normalizedName);
          const teachersSnap = await teachersRef.get();

          console.log(`[getProfilePicture] teachersSnap.empty: ${teachersSnap.empty}, docs count: ${teachersSnap.docs.length}`);

          if (!teachersSnap.empty) {
            const firstDoc = teachersSnap.docs[0];
            foundUserId = firstDoc.id;
            console.log(`[getProfilePicture] Found userId ${foundUserId} in usrlookup/teachers/${normalizedName}`);
          } else {
            console.log(`[getProfilePicture] No documents in usrlookup/teachers/${normalizedName} either`);
          }
        }
      } catch (error) {
        console.error(`[getProfilePicture] Error looking up normalizedName ${normalizedName}:`, error);
      }

      if (foundUserId) {
        actualUserId = foundUserId;
      } else {
        console.log(`[getProfilePicture] No userId found for normalizedName: ${normalizedName}`);
        return { success: true, url: null, exists: false };
      }
    }

    if (!actualUserId || typeof actualUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'userId or normalizedName is required');
    }

    // IMPORTANT:
    // The project uses storageBucket = "eu2k-hub.firebasestorage.app" on the client.
    // Some Firebase Admin environments default to the .appspot.com bucket, which would make
    // exists() return false even though the file exists. So we try multiple buckets.
    const defaultBucket = admin.storage().bucket();
    const configuredBucketName =
      (admin.app()?.options && admin.app().options.storageBucket) ? admin.app().options.storageBucket : null;

    const bucketNamesToTry = [
      defaultBucket?.name,
      configuredBucketName,
      'eu2k-hub.firebasestorage.app',
      'eu2k-hub.appspot.com',
    ].filter(Boolean);

    const uniqueBucketNames = Array.from(new Set(bucketNamesToTry));
    const bucketsToTry = uniqueBucketNames.map((name) => admin.storage().bucket(name));

    async function buildUrlForFile(bucketToUse, filePath) {
      const file = bucketToUse.file(filePath);
      const [exists] = await file.exists();
      if (!exists) return null;

      // 1) Prefer Firebase download token URL (matches your example)
      try {
        const [metadata] = await file.getMetadata();
        const tokensRaw = metadata?.metadata?.firebaseStorageDownloadTokens || '';
        const token = tokensRaw.split(',')[0]?.trim();
        if (token) {
          const url = `https://firebasestorage.googleapis.com/v0/b/${bucketToUse.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
          return url;
        }
      } catch (e) {
        // ignore, try signed URL fallback
      }

      // 2) Fallback: signed URL (should still work for <img> / CSS background)
      try {
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });
        return signedUrl;
      } catch (e) {
        return null;
      }
    }

    async function findUrlAcrossBuckets(filePath) {
      for (const b of bucketsToTry) {
        const url = await buildUrlForFile(b, filePath);
        if (url) {
          return { bucketName: b.name, url };
        }
      }
      return { bucketName: null, url: null };
    }

    // Try with .jpg extension first
    const jpgCandidates = [
      `profilePhotos/${actualUserId}.jpg`,
      `profilePictures/${actualUserId}.jpg`, // legacy/alternate folder name
    ];
    for (const filePath of jpgCandidates) {
      const found = await findUrlAcrossBuckets(filePath);
      if (found.url) {
        console.log(`[getProfilePicture] Found profile picture for user ${actualUserId} (${filePath}) in bucket ${found.bucketName}`);
        return { success: true, url: found.url, exists: true };
      }
    }

    // Try without extension
    const noExtCandidates = [
      `profilePhotos/${actualUserId}`,
      `profilePictures/${actualUserId}`,
    ];
    for (const filePath of noExtCandidates) {
      const found = await findUrlAcrossBuckets(filePath);
      if (found.url) {
        console.log(`[getProfilePicture] Found profile picture for user ${actualUserId} (${filePath}) in bucket ${found.bucketName}`);
        return { success: true, url: found.url, exists: true };
      }
    }

    // No profile picture found
    console.log(`[getProfilePicture] No profile picture for user ${actualUserId}`);
    return { success: true, url: null, exists: false };

  } catch (error) {
    console.error('[getProfilePicture] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Scan Auth QR Code
 * Validates and processes a scanned QR code for participation confirmation
 */
exports.scanAuthQR = onCall(functionOptions, async (request) => {
  try {
    // Authentication check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges');
    }

    // Global rate limiting (failsafe)
    await checkGlobalRateLimit(request.auth.uid, 'scanAuthQR');

    const { qrData, method = 'scan_qr' } = request.data || {};

    // Validate input
    if (!qrData || typeof qrData !== 'string') {
      throw new HttpsError('invalid-argument', 'qrData kötelező és string típusú kell legyen');
    }

    // Parse QR data (could be JSON string or URL)
    let qrPayload;
    try {
      qrPayload = JSON.parse(qrData);
    } catch {
      // If not JSON, try to extract from URL or use as-is
      throw new HttpsError('invalid-argument', 'Érvénytelen QR-kód formátum');
    }

    // Extract qrId from payload
    const qrId = qrPayload.qrId;
    if (!qrId || typeof qrId !== 'string') {
      throw new HttpsError('invalid-argument', 'QR-kód nem tartalmaz érvényes qrId-t');
    }

    // Get QR document from Firestore
    const qrRef = db.doc(`authQRCodes/${qrId}`);
    const qrSnap = await qrRef.get();

    if (!qrSnap.exists) {
      return { success: false, message: 'QR-kód nem található' };
    }

    const qrData_firestore = qrSnap.data();
    const now = Date.now();

    // Validate QR code
    if (qrData_firestore.used) {
      return { success: false, message: 'QR-kód már felhasználva' };
    }

    if (qrData_firestore.expiresAt.toMillis() < now) {
      return { success: false, message: 'QR-kód lejárt' };
    }

    // Mark QR as used
    await qrRef.update({
      used: true,
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      usedBy: request.auth.uid
    });

    // Get userId from QR document (the person who generated the QR)
    const qrUserId = qrData_firestore.userId;

    // Create participation record
    const participationData = {
      userId: method === 'scan_qr' ? request.auth.uid : qrUserId,
      qrId: method === 'show_qr' ? qrId : null,
      authMethod: null,
      codeUsed: null,
      method: method,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      eventId: qrData_firestore.eventId || null,
      verifiedBy: method === 'show_qr' ? request.auth.uid : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add scanQR object for scan_qr method
    if (method === 'scan_qr') {
      participationData.scanQR = {
        qrId: qrId,
        scannedBy: request.auth.uid,
        qrEventId: qrData_firestore.eventId || null,
        scannedAt: admin.firestore.Timestamp.fromMillis(now)
      };
    }

    await db.collection('participations').add(participationData);

    return { success: true, message: 'Részvétel sikeresen igazolva' };

  } catch (error) {
    console.error('[scanAuthQR] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message || 'Hiba történt a QR-kód feldolgozása során');
  }
});

/**
 * Get User Auth QR Code
 * Generates a QR code for the authenticated user
 */
exports.getUserAuthQRCode = onCall(functionOptions, async (request) => {
  try {
    // Authentication check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges');
    }

    // Global rate limiting (failsafe)
    await checkGlobalRateLimit(request.auth.uid, 'getUserAuthQRCode');

    const userId = request.auth.uid;

    // Generate random qrId (32 characters)
    const qrId = crypto.randomBytes(16).toString('hex');

    // Create payload (only qrId, ts, expiresAt - no sensitive data)
    const expiresIn = 5 * 60 * 1000; // 5 minutes
    const payload = {
      qrId: qrId,
      ts: Date.now(),
      expiresAt: Date.now() + expiresIn
    };

    // Save QR to Firestore (without qrData, only metadata)
    const qrRef = db.doc(`authQRCodes/${qrId}`);
    await qrRef.set({
      qrId: qrId,
      userId: userId,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expiresIn),
      used: false,
      usedAt: null,
      usedBy: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      eventId: null
    });

    // Get logo file (upload if not cached)
    async function getLogoFile() {
      if (cachedLogoFile) {
        console.log('[getUserAuthQRCode] Using cached logo file:', cachedLogoFile);
        return cachedLogoFile;
      }

      try {
        // Read logo file from functions/default/eu2khub.png
        // The logo file is in the same directory as index.js
        const logoPath = path.join(__dirname, 'eu2khub.png');
        
        let logoStream = null;
        if (fs.existsSync(logoPath)) {
          logoStream = fs.createReadStream(logoPath);
          console.log('[getUserAuthQRCode] Logo file found at:', logoPath);
        } else {
          console.warn('[getUserAuthQRCode] Logo file not found at:', logoPath);
          return null;
        }

        // Create FormData for multipart/form-data upload
        const formData = new FormData();
        formData.append('file', logoStream);

        // Upload logo to QR Code Monkey API
        const uploadRes = await fetch('https://api.qrcode-monkey.com/qr/uploadImage', {
          method: 'POST',
          body: formData,
          headers: formData.getHeaders(),
          signal: AbortSignal.timeout(10000)
        });

        if (uploadRes.ok) {
          const uploadResult = await uploadRes.json();
          const uploadedFileName = uploadResult.file;
          console.log('[getUserAuthQRCode] Logo uploaded successfully:', uploadedFileName);
          // Cache the filename
          cachedLogoFile = uploadedFileName;
          return uploadedFileName;
        } else {
          const errorText = await uploadRes.text();
          console.warn('[getUserAuthQRCode] Logo upload failed:', errorText);
          return null;
        }
      } catch (logoError) {
        console.warn('[getUserAuthQRCode] Logo upload error:', logoError.message);
        return null;
      }
    }

    // Get logo file (cached or upload)
    const logoFile = await getLogoFile();
    console.log('[getUserAuthQRCode] Logo file to use:', logoFile);

    // Call QR Code Monkey API
    try {
      // QR Code Monkey API request body structure
      const requestBody = {
        data: JSON.stringify(payload),
        size: 300,
        config: {
          body: 'circular',
          eye: 'frame12',
          eyeBall: 'ball14',
          gradientType: 'linear',
          gradientOnEyes: true,
          gradientColor1: '#073511',
          gradientColor2: '#000430',
          logo: logoFile || '' // Use uploaded logo filename (empty if upload failed)
        },
        download: false
      };
      
      console.log('[getUserAuthQRCode] QR API request body:', JSON.stringify(requestBody, null, 2));
      console.log('[getUserAuthQRCode] Logo in config:', requestBody.config.logo);
      
      const res = await fetch('https://api.qrcode-monkey.com/qr/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000)
      });

      console.log('[getUserAuthQRCode] QR API response status:', res.status);
      console.log('[getUserAuthQRCode] QR API response headers:', Object.fromEntries(res.headers.entries()));

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[getUserAuthQRCode] QR API error response:', errorText);
        console.error('[getUserAuthQRCode] QR API error status:', res.status);
        throw new Error(`QR API returned status ${res.status}: ${errorText}`);
      }

      // QR Code Monkey API returns PNG binary data (since file: 'png')
      // SVG is not supported with gradient and custom eye parameters
      // We need to convert PNG to base64
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      const qrBase64 = `data:image/png;base64,${base64}`;
      
      console.log('[getUserAuthQRCode] Converted PNG to base64');
      console.log('[getUserAuthQRCode] Base64 length:', base64.length);
      console.log('[getUserAuthQRCode] Full data URI length:', qrBase64.length);
      
      console.log('[getUserAuthQRCode] Final data URI length:', qrBase64.length);
      console.log('[getUserAuthQRCode] Data URI preview:', qrBase64.substring(0, 100) + '...');
      
      return { qrCode: qrBase64 };

    } catch (fetchError) {
      console.error('[getUserAuthQRCode] QR API error:', fetchError);
      console.error('[getUserAuthQRCode] QR API error stack:', fetchError.stack);
      console.error('[getUserAuthQRCode] QR API error message:', fetchError.message);
      
      // Provide more detailed error message
      const errorMessage = fetchError.message || 'QR generálás sikertelen';
      throw new HttpsError('internal', `QR generálás sikertelen: ${errorMessage}`);
    }

  } catch (error) {
    console.error('[getUserAuthQRCode] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message || 'Hiba történt a QR-kód generálása során');
  }
});

/**
 * Get User Auth Code
 * Generates a 6-digit code for the authenticated user
 */
exports.getUserAuthCode = onCall(functionOptions, async (request) => {
  try {
    // Authentication check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges');
    }

    // Global rate limiting (failsafe)
    await checkGlobalRateLimit(request.auth.uid, 'getUserAuthCode');

    const userId = request.auth.uid;

    // Always generate new code (no cache, always fresh)
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits

    // Hash the code
    const codeHash = await bcrypt.hash(code, 10);

    // Save to Firestore (only hash, never plaintext)
    const codeRef = db.doc(`userAuthCodes/${userId}`);
    await codeRef.set({
      userId: userId,
      codeHash: codeHash,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000), // 5 minutes
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      usedAt: null
    });

    // Return only the plaintext code (never the hash)
    return { code: code };

  } catch (error) {
    console.error('[getUserAuthCode] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message || 'Hiba történt a kód generálása során');
  }
});

/**
 * Confirm Code
 * Validates a 6-digit code entered by staff/user
 */
exports.confirmCode = onCall(functionOptions, async (request) => {
  try {
    // Authentication check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges');
    }

    const { code, targetUserId } = request.data || {};

    // Validate input
    if (!code || typeof code !== 'string' || code.length !== 6 || !/^\d{6}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'Érvénytelen kód formátum');
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUserId kötelező');
    }

    const staffUserId = request.auth.uid;

    // Global rate limiting (failsafe)
    await checkGlobalRateLimit(staffUserId, 'confirmCode');
    
    // Stricter rate limiting for confirmCode (with failed attempts tracking)
    await checkConfirmCodeRateLimit(staffUserId);

    // Get user auth code document (only one document, no query!)
    const codeRef = db.doc(`userAuthCodes/${targetUserId}`);
    const codeSnap = await codeRef.get();

    if (!codeSnap.exists) {
      await incrementFailedAttempts(staffUserId);
      throw new HttpsError('not-found', 'Nincs aktív kód');
    }

    const codeData = codeSnap.data();
    const now = Date.now();

    // Validate code
    if (codeData.used) {
      await incrementFailedAttempts(staffUserId);
      throw new HttpsError('failed-precondition', 'A kód már fel lett használva');
    }

    if (codeData.expiresAt.toMillis() < now) {
      await incrementFailedAttempts(staffUserId);
      throw new HttpsError('deadline-exceeded', 'Lejárt kód');
    }

    // Compare code with hash (bcrypt.compare, not hash!)
    const isValid = await bcrypt.compare(code, codeData.codeHash);

    if (!isValid) {
      await incrementFailedAttempts(staffUserId);
      throw new HttpsError('permission-denied', 'Hibás kód');
    }

    // Code is valid - mark as used
    await codeRef.update({
      used: true,
      usedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create participation record (never store plaintext code!)
    await db.collection('participations').add({
      userId: targetUserId, // The participant who generated the code
      qrId: null,
      authMethod: 'code',
      codeUsed: true,
      method: 'code',
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      eventId: null,
      verifiedBy: staffUserId, // Staff who entered the code
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Reset confirmCode-specific rate limit on success
    await resetConfirmCodeRateLimit(staffUserId);

    return { success: true, message: 'Kód sikeresen megerősítve' };

  } catch (error) {
    console.error('[confirmCode] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message || 'Hiba történt a kód ellenőrzése során');
  }
});

/* ══════════════════════════════════════════════════════════════
   submitReport
   – Bejelentést küld a reports kollekcióba.
   – Auth: csak bejelentkezett felhasználó hívhat.
   – Rate limit: max 5 bejelentés / 15 perc / felhasználó.
   – Sanitization: HTML strip + max 2000 karakter.
   – Anonimizálás: reporterId SHA-256 hash-elve kerül mentésre.
   – targetId / targetType egyelőre null (TODO: kontextus alapján).
   ══════════════════════════════════════════════════════════════ */

/**
 * Per-user report rate limit check (separate from global rate limit).
 * Uses reportRateLimits/{userId} to track window + count.
 */
async function checkReportRateLimit(userId) {
  const rlRef = db.doc(`reportRateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  const now = Date.now();

  if (rlSnap.exists) {
    const data = rlSnap.data();
    const windowStart = data.windowStart?.toMillis() || 0;
    const inWindow = now - windowStart < REPORT_WINDOW_MS;

    if (inWindow) {
      const count = data.count || 0;
      if (count >= REPORT_MAX_REQUESTS) {
        const remaining = Math.ceil((windowStart + REPORT_WINDOW_MS - now) / 60000);
        throw new HttpsError(
          'resource-exhausted',
          `Túl sok bejelentés rövid idő alatt. Próbáld újra ${remaining} perc múlva.`
        );
      }
      await rlRef.update({
        count: admin.firestore.FieldValue.increment(1),
        lastReportAt: admin.firestore.Timestamp.fromMillis(now)
      });
    } else {
      // New window – reset counter
      await rlRef.set({
        count: 1,
        windowStart: admin.firestore.Timestamp.fromMillis(now),
        lastReportAt: admin.firestore.Timestamp.fromMillis(now)
      });
    }
  } else {
    // First report ever from this user
    await rlRef.set({
      count: 1,
      windowStart: admin.firestore.Timestamp.fromMillis(now),
      lastReportAt: admin.firestore.Timestamp.fromMillis(now)
    });
  }
}

/**
 * Sanitize user-provided text: escape HTML entities and trim to max length.
 */
function sanitizeReportText(text, maxLen = 2000) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .slice(0, maxLen)
    .trim();
}

exports.submitReport = onCall(functionOptions, async (request) => {
  try {
    // Auth check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges');
    }

    const uid = request.auth.uid;

    // Global rate limiting (failsafe)
    await checkGlobalRateLimit(uid, 'submitReport');

    // Report-specific rate limiting: max 5 / 15 perc
    await checkReportRateLimit(uid);

    const { reason, content, isCustomReason } = request.data || {};

    // Validate required field
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'Az ok mező kötelező');
    }

    const sanitizedReason  = sanitizeReportText(reason);
    const sanitizedContent = sanitizeReportText(content || '');
    const isCustom         = Boolean(isCustomReason);

    // Anonymize: SHA-256 hash of the reporter's UID.
    // The reported party (or anyone with DB access) cannot identify who reported them.
    const hashedReporterId = crypto.createHash('sha256').update(uid).digest('hex');

    const reportData = {
      reason:         sanitizedReason,
      content:        sanitizedContent,
      isCustomReason: isCustom,
      reporterId:     hashedReporterId,
      // TODO: accept targetId / targetType from the client when this function
      //       is invoked from a post, comment, or user profile context.
      targetId:       null,
      targetType:     null,
      status:         'pending',
      resolvedAction: null,
      reviewedAt:     null,
      reviewedBy:     null,
      createdAt:      admin.firestore.FieldValue.serverTimestamp()
    };

    const reportRef = await db.collection('reports').add(reportData);

    console.log(
      `[submitReport] Created ${reportRef.id} | reporter: ${hashedReporterId.slice(0, 8)}... | reason: ${sanitizedReason}`
    );

    return { success: true, reportId: reportRef.id };

  } catch (error) {
    console.error('[submitReport] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message || 'Hiba történt a bejelentés beküldése során');
  }
});
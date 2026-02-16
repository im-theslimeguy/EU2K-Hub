/**
 * EU2K Hub News Publishing Cloud Function
 * Region: europe-west3 (Frankfurt)
 * 
 * Features:
 * - Transaction-based ID generation
 * - Signed URL for image upload (5 min expiry)
 * - URL safety check with fallback
 * - HTML injection prevention
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

// Region configuration
const region = 'europe-west3';

// Global rate limiting configuration (failsafe for ALL functions)
const RATE_LIMIT_REQUESTS_PER_MINUTE = 30;
const RATE_LIMIT_MIN_INTERVAL_MS = 100;
const RATE_LIMIT_BURST = 3;

/**
 * Global rate limiting helper (failsafe for ALL functions)
 */
async function checkGlobalRateLimit(userId, functionName = 'unknown') {
  const rlRef = db.doc(`rateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  const now = Date.now();

  if (rlSnap.exists) {
    const data = rlSnap.data();
    const lastRequestTime = data.lastRequestTime?.toMillis() || 0;
    const requestTimes = data.requestTimes || [];

    if (now - lastRequestTime < RATE_LIMIT_MIN_INTERVAL_MS) {
      const recentRequests = requestTimes.filter((time) => time > now - 1000);
      if (recentRequests.length >= RATE_LIMIT_BURST) {
        throw new HttpsError('resource-exhausted', 'Túl gyakori kérések. Várj egy kicsit.');
      }
    }

    const oneMinuteAgo = now - 60 * 1000;
    const recentRequests = requestTimes.filter((time) => time > oneMinuteAgo);

    if (recentRequests.length >= RATE_LIMIT_REQUESTS_PER_MINUTE) {
      throw new HttpsError('resource-exhausted', 'Túl sok kérés rövid idő alatt. Próbáld újra később.');
    }

    const updatedRequestTimes = [...recentRequests, now].slice(-RATE_LIMIT_REQUESTS_PER_MINUTE);
    await rlRef.update({
      lastRequestTime: admin.firestore.Timestamp.fromMillis(now),
      requestTimes: updatedRequestTimes,
      lastFunction: functionName
    });
  } else {
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

// HTML tag detection regex
const HTML_TAG_REGEX = /<[^>]*>/;

// Domain blacklist for URL safety (fallback when API unavailable)
const DOMAIN_BLACKLIST = [
  'malware.com', 'phishing.com', 'evil.com',
  // Add more known bad domains here
];

/**
 * Check if a URL is potentially unsafe
 * Fallback strategy: API -> Blacklist -> Allow with log
 */
async function checkUrlSafety(url) {
  if (!url) return { safe: true, checked: false };

  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const domain = urlObj.hostname.toLowerCase();

    // Check against blacklist
    if (DOMAIN_BLACKLIST.some(bad => domain.includes(bad))) {
      return { safe: false, reason: 'Domain blacklisted', checked: true };
    }

    // TODO: Integrate Google Safe Browsing API here
    // For now, return safe with log
    console.log(`[URL Safety] URL checked (blacklist only): ${url}`);
    return { safe: true, checked: true };

  } catch (error) {
    console.warn(`[URL Safety] Failed to check URL: ${url}`, error.message);
    // Fallback: allow but log
    return { safe: true, checked: false, warning: 'URL check failed, allowing' };
  }
}

/**
 * Validate inputs on server side
 */
function validateInputs(data) {
  const { title, author, desc, link } = data;
  const errors = [];

  // Title validation
  if (!title || typeof title !== 'string') {
    errors.push({ field: 'title', message: 'Title is required' });
  } else if (title.trim().length < 3) {
    errors.push({ field: 'title', message: 'Title too short (min 3 chars)' });
  } else if (title.trim().length > 120) {
    errors.push({ field: 'title', message: 'Title too long (max 120 chars)' });
  } else if (HTML_TAG_REGEX.test(title)) {
    errors.push({ field: 'title', message: 'Title cannot contain HTML' });
  }

  // Author validation
  if (!author || typeof author !== 'string' || !author.trim()) {
    errors.push({ field: 'author', message: 'Author is required' });
  } else if (HTML_TAG_REGEX.test(author)) {
    errors.push({ field: 'author', message: 'Author cannot contain HTML' });
  }

  // Description HTML check
  if (desc && HTML_TAG_REGEX.test(desc)) {
    errors.push({ field: 'desc', message: 'Description cannot contain HTML' });
  }

  // Link HTML check
  if (link && HTML_TAG_REGEX.test(link)) {
    errors.push({ field: 'link', message: 'Link cannot contain HTML' });
  }

  return errors;
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
    throw new HttpsError('permission-denied', 'Only staff can access this endpoint');
  }

  return { uid, claims };
}

/**
 * Get signed upload URL for image
 * 5-minute expiry, single use
 */
exports.getNewsUploadUrl = onCall({ region }, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'getNewsUploadUrl');
    }
    
    // Require authenticated staff user
    const { uid } = await requireStaff(request);

    const { contentType, newsId } = request.data;

    if (!contentType || !contentType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'Invalid content type, must be image');
    }

    const bucket = storage.bucket();
    const fileName = `newsPictures/${newsId}`;
    const file = bucket.file(fileName);

    // Generate signed URL for upload (5 minute expiry)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
      contentType: contentType
    });

    console.log(`[News Upload] Generated signed URL for ${fileName}`);

    return {
      uploadUrl: signedUrl,
      fileName: fileName,
      expiresIn: 300 // seconds
    };

  } catch (error) {
    console.error('[News Upload] Error generating signed URL:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to generate upload URL');
  }
});

/**
 * Publish news article
 * - Validates inputs
 * - Checks URL safety
 * - Uses transaction for ID generation
 * - Creates Firestore document
 */
exports.publishNews = onCall({ region }, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'publishNews');
    }
    
    // Require authenticated staff user
    const { uid } = await requireStaff(request);

    const { title, author, desc, link, imageUrl, customDate } = request.data;

    // Validate inputs
    const validationErrors = validateInputs({ title, author, desc, link });
    if (validationErrors.length > 0) {
      throw new HttpsError('invalid-argument', 'Validation failed', { errors: validationErrors });
    }

    // Check URL safety (if provided)
    if (link) {
      const urlCheck = await checkUrlSafety(link);
      if (!urlCheck.safe) {
        throw new HttpsError('invalid-argument', 'Link failed safety check', {
          reason: urlCheck.reason
        });
      }
    }

    // Parse custom date or use current timestamp
    let dateValue;
    if (customDate && typeof customDate === 'string') {
      // Parse the date string (format: YYYY-MM-DD) and convert to Firestore Timestamp
      const parsedDate = new Date(customDate);
      if (!isNaN(parsedDate.getTime())) {
        dateValue = admin.firestore.Timestamp.fromDate(parsedDate);
      } else {
        dateValue = admin.firestore.FieldValue.serverTimestamp();
      }
    } else {
      dateValue = admin.firestore.FieldValue.serverTimestamp();
    }

    // Transaction-based ID generation
    let newId;
    let newsDocRef;

    await db.runTransaction(async (transaction) => {
      const metaRef = db.doc('homePageData/news');
      const metaDoc = await transaction.get(metaRef);

      if (!metaDoc.exists) {
        // Initialize meta doc if it doesn't exist
        newId = 1;
        transaction.set(metaRef, { latestId: 1 });
      } else {
        newId = (metaDoc.data().latestId || 0) + 1;
        transaction.update(metaRef, { latestId: newId });
      }

      // Create news document
      newsDocRef = db.doc(`homePageData/news/hirek/${newId}`);
      transaction.set(newsDocRef, {
        title: title.trim(),
        author: author.trim(),
        desc: desc ? desc.trim() : '',
        link: link ? link.trim() : '',
        image: imageUrl || '',
        date: dateValue,
        hubExclusive: false,
        createdBy: uid
      });
    });

    console.log(`[News Publish] Successfully created news #${newId} by user ${uid}`);

    return {
      success: true,
      newsId: newId,
      message: 'News published successfully'
    };

  } catch (error) {
    console.error('[News Publish] Error:', error);

    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to publish news', {
      message: error.message
    });
  }
});

/**
 * Cleanup orphan images (scheduled function)
 * Runs daily to remove images without corresponding Firestore documents
 */
// TODO: Implement scheduled cleanup function
// exports.cleanupOrphanNewsImages = onSchedule('every 24 hours', async (event) => { ... });

// ========== EVENT PUBLISH FUNCTIONS ==========

/**
 * Validate event inputs on server side
 */
function validateEventInputs(data) {
  const { title, place, dateFrom, dateTo, link } = data;
  const errors = [];

  // Title validation
  if (!title || typeof title !== 'string') {
    errors.push({ field: 'title', message: 'Title is required' });
  } else if (title.trim().length < 3) {
    errors.push({ field: 'title', message: 'Title too short (min 3 chars)' });
  } else if (title.trim().length > 120) {
    errors.push({ field: 'title', message: 'Title too long (max 120 chars)' });
  } else if (HTML_TAG_REGEX.test(title)) {
    errors.push({ field: 'title', message: 'Title cannot contain HTML' });
  }

  // Place validation
  if (!place || typeof place !== 'string' || !place.trim()) {
    errors.push({ field: 'place', message: 'Place is required' });
  } else if (HTML_TAG_REGEX.test(place)) {
    errors.push({ field: 'place', message: 'Place cannot contain HTML' });
  }

  // Date validation
  if (!dateFrom) {
    errors.push({ field: 'dateFrom', message: 'Start date is required' });
  }
  if (!dateTo) {
    errors.push({ field: 'dateTo', message: 'End date is required' });
  }

  // Link HTML check
  if (link && HTML_TAG_REGEX.test(link)) {
    errors.push({ field: 'link', message: 'Link cannot contain HTML' });
  }

  return errors;
}

/**
 * Ensure CORS is configured on the storage bucket
 * This should be called once to set up CORS for browser uploads
 */
async function ensureCorsConfigured() {
  try {
    const bucket = storage.bucket();
    const [metadata] = await bucket.getMetadata();
    const currentCors = metadata.cors || [];

    // Check if CORS is already configured for our origins
    const requiredOrigins = ['https://eu2khub.eu', 'https://www.eu2khub.eu'];
    const hasCors = currentCors.some(corsRule => 
      corsRule.origin && corsRule.origin.some(origin => requiredOrigins.includes(origin))
    );

    if (!hasCors) {
      console.log('[CORS] Configuring CORS for storage bucket...');
      const corsConfig = [
        {
          origin: requiredOrigins,
          method: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE', 'OPTIONS'],
          responseHeader: ['Content-Type', 'Content-Length', 'ETag', 'x-goog-resumable', 'x-goog-hash'],
          maxAgeSeconds: 3600
        }
      ];

      await bucket.setCorsConfiguration(corsConfig);
      console.log('[CORS] CORS configuration applied successfully');
    }
  } catch (error) {
    // Log but don't fail - CORS might already be set via gcloud CLI
    console.warn('[CORS] Could not configure CORS (may already be set):', error.message);
  }
}

/**
 * Setup CORS configuration for storage bucket (one-time setup)
 * Call this function once to configure CORS for browser uploads
 */
exports.setupStorageCors = onCall({ region }, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'setupStorageCors');
    }
    
    // Require authenticated admin user
    const { uid, claims } = await requireStaff(request);
    if (!claims.admin && !claims.owner) {
      throw new HttpsError('permission-denied', 'Only admins can configure CORS');
    }

    await ensureCorsConfigured();

    return {
      success: true,
      message: 'CORS configuration applied successfully'
    };
  } catch (error) {
    console.error('[CORS Setup] Error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to configure CORS');
  }
});

/**
 * Get signed upload URL for event image
 * 5-minute expiry, single use
 */
exports.getEventUploadUrl = onCall({ region }, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'getEventUploadUrl');
    }
    
    // Authentication check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;

    // Check staff privileges
    const userRecord = await admin.auth().getUser(uid);
    const claims = userRecord.customClaims || {};

    if (!claims.admin && !claims.owner && !claims.teacher) {
      throw new HttpsError('permission-denied', 'Only staff can upload event images');
    }

    const { contentType, eventId } = request.data;

    if (!contentType || !contentType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'Invalid content type, must be image');
    }

    // Ensure CORS is configured (idempotent, won't fail if already set)
    await ensureCorsConfigured();

    const bucket = storage.bucket();
    const fileName = `eventPictures/${eventId}`;
    const file = bucket.file(fileName);

    // Generate signed URL for upload (5 minute expiry)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
      contentType: contentType
    });

    console.log(`[Event Upload] Generated signed URL for ${fileName}`);

    return {
      uploadUrl: signedUrl,
      fileName: fileName,
      expiresIn: 300 // seconds
    };

  } catch (error) {
    console.error('[Event Upload] Error generating signed URL:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to generate upload URL');
  }
});

/**
 * Publish event
 * - Validates inputs
 * - Checks URL safety
 * - Uses transaction for ID generation
 * - Creates Firestore document at homePageData/events/események/{id}
 */
exports.publishEvent = onCall({ region }, async (request) => {
  try {
    // Global rate limiting (failsafe)
    if (request.auth) {
      await checkGlobalRateLimit(request.auth.uid, 'publishEvent');
    }
    
    // Authentication check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;

    // Check staff privileges
    const userRecord = await admin.auth().getUser(uid);
    const claims = userRecord.customClaims || {};

    if (!claims.admin && !claims.owner && !claims.teacher) {
      throw new HttpsError('permission-denied', 'Only staff can publish events');
    }

    const { title, link, place, description, imageUrl, dateFrom, dateTo } = request.data;

    // Validate inputs
    const validationErrors = validateEventInputs({ title, place, dateFrom, dateTo, link });
    if (validationErrors.length > 0) {
      throw new HttpsError('invalid-argument', 'Validation failed', { errors: validationErrors });
    }

    // Check URL safety (if provided)
    if (link) {
      const urlCheck = await checkUrlSafety(link);
      if (!urlCheck.safe) {
        throw new HttpsError('invalid-argument', 'Link failed safety check', {
          reason: urlCheck.reason
        });
      }
    }

    // Parse dates
    const dateFromValue = admin.firestore.Timestamp.fromDate(new Date(dateFrom));
    const dateToValue = admin.firestore.Timestamp.fromDate(new Date(dateTo));

    // Transaction-based ID generation
    let newId;
    let eventDocRef;

    await db.runTransaction(async (transaction) => {
      const metaRef = db.doc('homePageData/events');
      const metaDoc = await transaction.get(metaRef);

      if (!metaDoc.exists) {
        // Initialize meta doc if it doesn't exist
        newId = 1;
        transaction.set(metaRef, { latestId: 1 });
      } else {
        newId = (metaDoc.data().latestId || 0) + 1;
        transaction.update(metaRef, { latestId: newId });
      }

      // Create event document
      eventDocRef = db.doc(`homePageData/events/esemenyek/${newId}`);
      transaction.set(eventDocRef, {
        title: title.trim(),
        link: link ? link.trim() : '',
        image: imageUrl || '',
        description: description ? description.trim() : '',
        place: place.trim(),
        'date-from': dateFromValue,
        'date-to': dateToValue,
        createdBy: uid
      });
    });

    console.log(`[Event Publish] Successfully created event #${newId} by user ${uid}`);

    return {
      success: true,
      eventId: newId,
      message: 'Event published successfully'
    };

  } catch (error) {
    console.error('[Event Publish] Error:', error);

    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to publish event', {
      message: error.message
    });
  }
});

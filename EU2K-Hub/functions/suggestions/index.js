const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

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
        throw new functions.https.HttpsError('resource-exhausted', 'Túl gyakori kérések. Várj egy kicsit.');
      }
    }

    const oneMinuteAgo = now - 60 * 1000;
    const recentRequests = requestTimes.filter((time) => time > oneMinuteAgo);

    if (recentRequests.length >= RATE_LIMIT_REQUESTS_PER_MINUTE) {
      throw new functions.https.HttpsError('resource-exhausted', 'Túl sok kérés rövid idő alatt. Próbáld újra később.');
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

/**
 * Suggestions Cloud Function
 * Handles loading and processing suggestion data
 */
exports.suggestions = functions.https.onCall(
  {
    region: 'europe-west3',
    memory: '256MiB',
    timeoutSeconds: 60,
    cors: true,
  },
  async (request) => {
    const { data, auth } = request;
    const action = data?.action;

    if (!auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Global rate limiting (failsafe)
    await checkGlobalRateLimit(auth.uid, 'suggestions');

    const userId = auth.uid;

    switch (action) {
      case 'load':
        return await handleLoadSuggestions(userId, data);
      case 'autocomplete':
        return await handleAutocomplete(userId, data);
      default:
        throw new functions.https.HttpsError('invalid-argument', `Unknown action: ${action}`);
    }
  }
);

/**
 * Load suggestions sorted by date proximity to current date
 */
async function handleLoadSuggestions(userId, data) {
  try {
    console.log('[Suggestions] Loading suggestions for user:', userId);

    // Get all suggestions from root collection
    const suggestionsRef = db.collection('suggestions');
    const snapshot = await suggestionsRef.get();

    console.log(`[Suggestions] 📊 Found ${snapshot.size} total suggestions in Firestore`);

    if (snapshot.empty) {
      console.log('[Suggestions] No suggestions found');
      return { suggestions: [] };
    }

    const now = new Date();
    const suggestions = [];

    for (const docSnap of snapshot.docs) {
      const docData = docSnap.data() || {};
      const docId = docSnap.id;
      
      console.log(`[Suggestions] 📦 Processing suggestion ${docId}: title="${docData.title}", restrictToUsers="${docData.restrictToUsers || ''}", restrictToGroups="${docData.restrictToGroups || ''}"`);
      
      // Get createdAt timestamp
      let createdAt = docData.createdAt;
      let createdAtDate = null;
      
      if (createdAt && createdAt.toDate) {
        createdAtDate = createdAt.toDate();
      } else if (createdAt instanceof Date) {
        createdAtDate = createdAt;
      } else if (typeof createdAt === 'number') {
        createdAtDate = new Date(createdAt);
      }

      // Calculate date difference for sorting (absolute distance from now)
      let dateDiff = Infinity;
      if (createdAtDate) {
        dateDiff = Math.abs(now.getTime() - createdAtDate.getTime());
      }

      // Check restrictToUsers
      const restrictToUsers = (docData.restrictToUsers || '').trim();
      if (restrictToUsers) {
        console.log(`[Suggestions] 🔐 Checking user restriction for ${docId}: "${restrictToUsers}"`);
        // Need to check if current user is in the list
        const restrictedNames = restrictToUsers.split(',').map(n => n.trim().toLowerCase()).filter(n => n);
        
        // First check if userId is directly in the list
        let userAllowed = restrictedNames.includes(userId.toLowerCase());
        console.log(`[Suggestions] 🔑 Direct userId match: ${userAllowed} (userId: ${userId})`);
        
        // If not, try to match by fullName or normalizedName
        if (!userAllowed) {
          try {
            const userFullName = await lookupUserFullName(userId);
            console.log(`[Suggestions] 👤 User fullName: "${userFullName}"`);
            if (userFullName) {
              userAllowed = restrictedNames.some(name => 
                name === userFullName.toLowerCase() || 
                normalizeNameToId(userFullName) === name
              );
            }
          } catch (err) {
            console.warn('[Suggestions] Failed to check user restriction:', err);
          }
        }
        
        console.log(`[Suggestions] ${userAllowed ? '✅' : '❌'} User allowed: ${userAllowed}`);
        
        if (!userAllowed) {
          console.log(`[Suggestions] ⛔ Skipping ${docId} - user not in restrictToUsers`);
          continue; // Skip this suggestion
        }
      }

      // Check restrictToGroups
      const restrictToGroups = (docData.restrictToGroups || '').trim();
      if (restrictToGroups) {
        console.log(`[Suggestions] 🔐 Checking group restriction for ${docId}: "${restrictToGroups}"`);
        let groupAllowed = false;
        const restrictedGroups = restrictToGroups.split(',').map(g => g.trim()).filter(g => g);
        
        for (const groupName of restrictedGroups) {
          // Check if user is in this class or group
          try {
            // First check if it's a classId format (e.g., "2030e")
            const classMatch = groupName.match(/^(\d{4})([a-zA-Z])$/);
            if (classMatch) {
              const classId = groupName.toLowerCase();
              const userInClass = await checkUserInClass(userId, classId);
              if (userInClass) {
                groupAllowed = true;
                break;
              }
            } else {
              // Check as group
              const userInGroup = await checkUserInGroup(userId, groupName);
              if (userInGroup) {
                groupAllowed = true;
                break;
              }
            }
          } catch (err) {
            console.warn('[Suggestions] Failed to check group restriction:', err);
          }
        }
        
        if (!groupAllowed) {
          console.log(`[Suggestions] ⛔ Skipping ${docId} - user not in restrictToGroups`);
          continue; // Skip this suggestion
        }
      }

      // Resolve owner name from ownerId (normalizedName)
      const ownerId = docData.ownerId || '';
      let ownerName = 'Ismeretlen felhasználó';
      
      if (ownerId) {
        try {
          const resolvedName = await resolveNormalizedName(ownerId);
          if (resolvedName) {
            ownerName = resolvedName;
          }
        } catch (err) {
          console.warn('[Suggestions] Failed to resolve owner name:', err);
        }
      }

      // Format date string as yyyy.mm.dd
      let dateString = '';
      if (createdAtDate) {
        const year = createdAtDate.getFullYear();
        const month = String(createdAtDate.getMonth() + 1).padStart(2, '0');
        const day = String(createdAtDate.getDate()).padStart(2, '0');
        dateString = `${year}.${month}.${day}`;
      }

      console.log(`[Suggestions] ✅ Adding suggestion ${docId}: "${docData.title}" by ${ownerName}`);
      
      suggestions.push({
        id: docSnap.id,
        title: docData.title || '',
        description: docData.content || '',
        hive: docData.hive || false,
        share: docData.share || false,
        ownerName: ownerName,
        ownerId: ownerId,
        dateString: dateString,
        createdAt: createdAtDate ? createdAtDate.toISOString() : null,
        dateDiff: dateDiff
      });
    }

    // Sort by date proximity (closest to now first)
    suggestions.sort((a, b) => a.dateDiff - b.dateDiff);

    // Remove dateDiff from output and limit to 20
    const result = suggestions.slice(0, 20).map(s => {
      const { dateDiff, ...rest } = s;
      return rest;
    });

    console.log(`[Suggestions] 📊 Final result: ${result.length} suggestions after filtering and sorting`);
    return { suggestions: result };

  } catch (error) {
    console.error('[Suggestions] Error loading suggestions:', error);
    throw new functions.https.HttpsError('internal', 'Failed to load suggestions');
  }
}

/**
 * Resolve normalizedName or userId to fullName
 * Searches in usrlookup/teachers/{normalizedName} and usrlookup/names/{normalizedName}
 * Also checks users/{userId} as fallback if input looks like a userId
 */
async function resolveNormalizedName(ownerIdOrName) {
  if (!ownerIdOrName) return null;

  // Check if it looks like a Firebase UID (long alphanumeric string)
  const looksLikeUid = /^[a-zA-Z0-9]{20,}$/.test(ownerIdOrName);
  
  // If it looks like a UID, try to get fullName from users collection first
  if (looksLikeUid) {
    try {
      const userDoc = await db.collection('users').doc(ownerIdOrName).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.fullName) {
          console.log(`[Suggestions] Found user fullName from users/${ownerIdOrName}: ${userData.fullName}`);
          return userData.fullName;
        }
        // If user has normalizedName, use it to lookup in usrlookup
        if (userData.normalizedName) {
          const resolved = await resolveNormalizedNameFromLookup(userData.normalizedName);
          if (resolved) return resolved;
        }
      }
    } catch (err) {
      console.warn(`[Suggestions] Error checking users collection for ${ownerIdOrName}:`, err);
    }
  }

  // Try as normalizedName in usrlookup collections
  return await resolveNormalizedNameFromLookup(ownerIdOrName);
}

/**
 * Helper: resolve normalizedName from usrlookup collections
 */
async function resolveNormalizedNameFromLookup(normalizedName) {
  if (!normalizedName) return null;

  // Try teachers first
  try {
    const teachersRef = db.collection('usrlookup').doc('teachers').collection(normalizedName);
    const teachersSnap = await teachersRef.limit(1).get();
    
    if (!teachersSnap.empty) {
      const userData = teachersSnap.docs[0].data();
      if (userData.fullName) {
        console.log(`[Suggestions] Found teacher name for ${normalizedName}: ${userData.fullName}`);
        return userData.fullName;
      }
    }
  } catch (err) {
    console.warn(`[Suggestions] Error checking teachers for ${normalizedName}:`, err);
  }

  // Try names (students/others)
  try {
    const namesRef = db.collection('usrlookup').doc('names').collection(normalizedName);
    const namesSnap = await namesRef.limit(1).get();
    
    if (!namesSnap.empty) {
      const userData = namesSnap.docs[0].data();
      if (userData.fullName) {
        console.log(`[Suggestions] Found user name for ${normalizedName}: ${userData.fullName}`);
        return userData.fullName;
      }
    }
  } catch (err) {
    console.warn(`[Suggestions] Error checking names for ${normalizedName}:`, err);
  }

  console.log(`[Suggestions] Could not resolve name for ${normalizedName}`);
  return null;
}

/**
 * Lookup user's fullName by userId
 */
async function lookupUserFullName(userId) {
  try {
    // Check teachers
    const teachersGroup = db.collectionGroup('teachers');
    const teachersQuery = teachersGroup.where(admin.firestore.FieldPath.documentId(), '==', userId).limit(1);
    // This won't work directly, need to iterate through collections
    
    // Alternative: check usrlookup structure
    // The structure is usrlookup/teachers/{normalizedName}/{userId}
    // We need to find where the userId exists
    
    // Check the user's document for normalizedName
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const userData = userSnap.data();
      if (userData.fullName) {
        return userData.fullName;
      }
      if (userData.normalizedName) {
        const resolved = await resolveNormalizedName(userData.normalizedName);
        if (resolved) return resolved;
      }
    }
    
    return null;
  } catch (err) {
    console.warn('[Suggestions] Error looking up user fullName:', err);
    return null;
  }
}

/**
 * Check if user is in a class
 */
async function checkUserInClass(userId, classId) {
  try {
    const classUserRef = db.collection('classes').doc(classId).collection('users').doc(userId);
    const userSnap = await classUserRef.get();
    return userSnap.exists;
  } catch (err) {
    return false;
  }
}

/**
 * Check if user is in a group
 */
async function checkUserInGroup(userId, groupId) {
  try {
    const groupUserRef = db.collection('groups').doc(groupId).collection('users').doc(userId);
    const userSnap = await groupUserRef.get();
    return userSnap.exists;
  } catch (err) {
    return false;
  }
}

/**
 * Normalize a full name to an ID format
 * Removes accents, converts to lowercase, replaces spaces with underscores
 */
function normalizeNameToId(fullName) {
  if (!fullName) return '';
  
  // Remove accents/diacritics
  const normalized = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  // Convert to lowercase
  const lowercased = normalized.toLowerCase();
  
  // Replace spaces with underscores
  const simplified = lowercased.replace(/\s+/g, '_');
  
  return simplified;
}

/**
 * Handle autocomplete request - returns users, classes, and groups for ghost suggestions
 */
async function handleAutocomplete(userId, data) {
  try {
    console.log('[Suggestions] Loading autocomplete data for user:', userId);
    
    const users = [];
    const classes = [];
    const groups = [];
    const seenNormalizedNames = new Set();
    
    // Load users from usrlookup/teachers
    try {
      const teachersDoc = db.collection('usrlookup').doc('teachers');
      const teacherCollections = await teachersDoc.listCollections();
      
      for (const coll of teacherCollections) {
        const normalizedName = coll.id;
        if (seenNormalizedNames.has(normalizedName)) continue;
        
        const docs = await coll.limit(1).get();
        if (!docs.empty) {
          const userData = docs.docs[0].data() || {};
          const fullName = userData.fullName;
          if (fullName) {
            seenNormalizedNames.add(normalizedName);
            users.push({
              id: docs.docs[0].id,
              normalizedName: normalizedName,
              display: fullName,
              match: fullName.toLowerCase()
            });
          }
        }
      }
    } catch (err) {
      console.warn('[Suggestions] Failed to load teachers:', err);
    }
    
    // Load users from usrlookup/names
    try {
      const namesDoc = db.collection('usrlookup').doc('names');
      const nameCollections = await namesDoc.listCollections();
      
      for (const coll of nameCollections) {
        const normalizedName = coll.id;
        if (seenNormalizedNames.has(normalizedName)) continue;
        
        const docs = await coll.limit(1).get();
        if (!docs.empty) {
          const userData = docs.docs[0].data() || {};
          const fullName = userData.fullName;
          if (fullName) {
            seenNormalizedNames.add(normalizedName);
            users.push({
              id: docs.docs[0].id,
              normalizedName: normalizedName,
              display: fullName,
              match: fullName.toLowerCase()
            });
          }
        }
      }
    } catch (err) {
      console.warn('[Suggestions] Failed to load names:', err);
    }
    
    // Load classes
    try {
      const classesSnap = await db.collection('classes').limit(100).get();
      for (const docSnap of classesSnap.docs) {
        const classId = docSnap.id;
        const displayName = formatClassLabel(classId);
        classes.push({
          id: classId,
          display: displayName,
          match: displayName.toLowerCase()
        });
      }
    } catch (err) {
      console.warn('[Suggestions] Failed to load classes:', err);
    }
    
    // Load groups
    try {
      const groupsSnap = await db.collection('groups').limit(100).get();
      for (const docSnap of groupsSnap.docs) {
        const groupId = docSnap.id;
        const data = docSnap.data() || {};
        const groupName = data.name || groupId;
        groups.push({
          id: groupId,
          display: groupName,
          match: groupName.toLowerCase()
        });
      }
    } catch (err) {
      console.warn('[Suggestions] Failed to load groups:', err);
    }
    
    console.log(`[Suggestions] Autocomplete: ${users.length} users, ${classes.length} classes, ${groups.length} groups`);
    
    return { users, classes, groups };
    
  } catch (error) {
    console.error('[Suggestions] Error in autocomplete:', error);
    throw new functions.https.HttpsError('internal', 'Failed to load autocomplete data');
  }
}

/**
 * Format class ID to display label
 * e.g., "2030e" -> "8.E Osztály"
 */
function formatClassLabel(classId) {
  if (!classId) return classId;
  const match = classId.match(/^(\d{4})([a-zA-Z])$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const letter = match[2].toUpperCase();
    const currentYear = new Date().getFullYear();
    const grade = currentYear - year + 8;
    return `${grade}.${letter} Osztály`;
  }
  return classId;
}


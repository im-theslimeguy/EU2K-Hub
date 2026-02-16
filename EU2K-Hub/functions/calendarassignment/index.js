/**
 * EU2K Hub Calendar Assignment Cloud Function - MONOLITHIC API
 * Region: europe-west3 (Frankfurt)
 * 
 * Refactored to a single entry point to reduce Cloud Run service count
 * and stay within project CPU quota.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { differenceInWeeks, startOfWeek, parseISO, format, isBefore, isAfter, eachWeekOfInterval, eachMonthOfInterval, getDay } = require('date-fns');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
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

// Resource limits
const runtimeOpts = {
    region,
    maxInstances: 2,
    memory: '512MiB',
    timeoutSeconds: 120
};

const SESSION_COLLECTION = 'calendarSessions';

// ========== HELPER FUNCTIONS ==========

function formatClassName(classId) {
    const match = classId.match(/^(\d{4})([a-z])$/i);
    if (!match) return classId;
    const gradYear = parseInt(match[1]);
    const classLetter = match[2].toUpperCase();
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const schoolYear = currentMonth < 8 ? currentYear : currentYear + 1;
    const grade = 12 - (gradYear - schoolYear);
    if (grade < 1 || grade > 12) return classId;
    return `${grade}.${classLetter} Osztály`;
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function formatMinutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatTime(date) {
    if (!date) return null;
    return date.toLocaleTimeString('hu-HU', {
        timeZone: 'Europe/Budapest',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function getSchoolWeekNumber(date, firstDayTimestamp) {
    const firstDay = firstDayTimestamp.toDate ? firstDayTimestamp.toDate() : new Date(firstDayTimestamp);
    const firstMonday = startOfWeek(firstDay, { weekStartsOn: 1 });
    const targetMonday = startOfWeek(date, { weekStartsOn: 1 });
    return differenceInWeeks(targetMonday, firstMonday) + 1;
}

function shouldApplyVariation(date, repeatRule, firstDayTimestamp) {
    const [type, countStr] = repeatRule.split('_');
    const count = parseInt(countStr);
    if (type === 'week') {
        const weekNum = getSchoolWeekNumber(date, firstDayTimestamp);
        return weekNum % count === 0;
    } else if (type === 'month') {
        const monthNum = date.getMonth() + 1;
        return monthNum % count === 0;
    }
    return false;
}

// ========== ACTION HANDLERS ==========

async function handleLoadClasses(request) {
    const uid = request.auth.uid;
    const token = request.auth.token;

    // Check custom claims for authorization
    const isAuthorized = token.admin === true || token.teacher === true || token.owner === true;
    if (!isAuthorized) {
        throw new HttpsError('permission-denied', 'Admin, teacher or owner access required');
    }

    const classMapping = {};
    const classes = [];

    // Own class lookup: users/{uid}/groups/ownclass
    let ownClassId = null;
    const ownClassDoc = await db.collection('users').doc(uid).collection('groups').doc('ownclass').get();
    if (ownClassDoc.exists) {
        const data = ownClassDoc.data() || {};
        if (data.classFinishes && data.classType) {
            ownClassId = `${data.classFinishes}${data.classType}`.toLowerCase();
        }
    }

    // Permitted class lookup: users/{uid}/groups/permittedClass
    let permittedClassId = null;
    let permittedRoles = null;
    const permittedDoc = await db.collection('users').doc(uid).collection('groups').doc('permittedClass').get();
    if (permittedDoc.exists) {
        const data = permittedDoc.data() || {};
        if (data.classFinishes && data.classType) {
            permittedClassId = `${data.classFinishes}${data.classType}`.toLowerCase();
            permittedRoles = {
                homeroomDeputy: data.homeroomDeputy === true,
                subjectTeacher: data.subjectTeacher === true,
                substituteTeacher: data.substituteTeacher === true,
                adminColleague: data.adminColleague === true
            };
        }
    }

    const targetClassIds = new Set([ownClassId, permittedClassId].filter(Boolean));
    for (const classId of targetClassIds) {
        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) continue;
        const formatted = formatClassName(classId);
        const isOwn = ownClassId === classId;
        let accessRole = isOwn ? 'owner' : null;
        let canEdit = isOwn;

        if (!isOwn && permittedClassId === classId && permittedRoles) {
            if (permittedRoles.homeroomDeputy) {
                accessRole = 'homeroomDeputy';
                canEdit = true;
                // TODO: if notification system is added later, notify class leader on changes
            } else if (permittedRoles.adminColleague) {
                accessRole = 'adminColleague';
                canEdit = token.admin === true || token.owner === true;
            } else if (permittedRoles.subjectTeacher) {
                accessRole = 'subjectTeacher';
                canEdit = false;
            } else if (permittedRoles.substituteTeacher) {
                accessRole = 'substituteTeacher';
                canEdit = false;
            }
        }

        classes.push({ id: classId, name: formatted, accessRole, canEdit });
        classMapping[formatted] = classId;
    }
    classes.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    await db.collection(SESSION_COLLECTION).doc(uid).set({
        classMapping,
        classAccess: classes.reduce((acc, cls) => {
            acc[cls.id] = { accessRole: cls.accessRole, canEdit: cls.canEdit };
            return acc;
        }, {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { classes };
}

async function handleSelectClass(request) {
    const uid = request.auth.uid;
    const { className } = request.data;
    if (!className) {
        throw new HttpsError('invalid-argument', 'Class name is required');
    }
    let classId = null;
    const sessionDoc = await db.collection(SESSION_COLLECTION).doc(uid).get();
    if (sessionDoc.exists) {
        const map = sessionDoc.data().classMapping || {};
        classId = map[className];
    }
    if (!classId) classId = className;
    await db.collection(SESSION_COLLECTION).doc(uid).set({
        selectedClassId: classId,
        selectedClassName: className
    }, { merge: true });
    return { success: true, classId, className };
}

async function handleSelectTimeSlot(request) {
    const uid = request.auth.uid;
    const { day, hour } = request.data;
    await db.collection(SESSION_COLLECTION).doc(uid).set({
        selectedDay: day,
        selectedHour: hour
    }, { merge: true });
    return { success: true };
}

async function handleLoadLessonTypes(request) {
    const { selectedHour } = request.data;
    const lessonsSnapshot = await db.collection('lessons').get();
    const timetableSnapshot = await db.collection('timetable').get();
    const timetableMap = {};
    timetableSnapshot.forEach(doc => { timetableMap[doc.id] = doc.data(); });

    const lessons = [];
    lessonsSnapshot.forEach(doc => {
        const data = doc.data();
        const id = doc.id;
        let startTime = null, finishTime = null;
        if (data.startTime) startTime = data.startTime.toDate ? formatTime(data.startTime.toDate()) : data.startTime;
        if (data.finishTime) finishTime = data.finishTime.toDate ? formatTime(data.finishTime.toDate()) : data.finishTime;
        lessons.push({ id, name: data.name || id, startTime, finishTime });
    });

    let defaultTimeline = null;
    if (selectedHour !== undefined && selectedHour !== null) {
        const defKey = `lesson${selectedHour}`;
        if (timetableMap[defKey]) {
            const tt = timetableMap[defKey];
            defaultTimeline = {
                startTime: tt.startTime && tt.startTime.toDate ? formatTime(tt.startTime.toDate()) : tt.startTime,
                finishTime: tt.finishTime && tt.finishTime.toDate ? formatTime(tt.finishTime.toDate()) : tt.finishTime
            };
        }
    }
    return { lessons, defaultTimeline };
}

async function handleLoadTeachers(request) {
    // Teachers are at usrlookup/teachers/{normalizedName}/{uid} with fullName field
    const teachersColRef = db.collection('usrlookup').doc('teachers');
    const teacherGroupsSnapshot = await teachersColRef.listCollections();

    const teachers = [];
    for (const col of teacherGroupsSnapshot) {
        const normalizedName = col.id;
        const docsSnapshot = await col.limit(1).get(); // Get first doc (uid) for fullName
        if (!docsSnapshot.empty) {
            const doc = docsSnapshot.docs[0];
            const data = doc.data();
            if (data.fullName) {
                teachers.push({
                    id: doc.id, // uid
                    normalizedName: normalizedName,
                    name: data.fullName,
                    fullName: data.fullName
                });
            }
        }
    }
    teachers.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    return { teachers };
}

async function handleValidateTimeline(request) {
    const uid = request.auth.uid;
    const { startTime, endTime, lessonNumber, lessonType } = request.data;

    let resolvedStartTime = startTime;
    let resolvedEndTime = endTime;
    let source = 'user_input';
    let collision = null;
    let warningMessage = null;

    // Get timetable defaults
    const timetableSnapshot = await db.collection('timetable').get();
    const timetableMap = {};
    timetableSnapshot.forEach(doc => { timetableMap[doc.id] = doc.data(); });

    // Resolve from defaults if not provided
    if (!resolvedStartTime || !resolvedEndTime) {
        const defKey = `lesson${lessonNumber}`;
        if (timetableMap[defKey]) {
            const tt = timetableMap[defKey];
            if (!resolvedStartTime) {
                resolvedStartTime = tt.startTime?.toDate ? formatTime(tt.startTime.toDate()) : tt.startTime;
                source = 'timetable_default';
            }
            if (!resolvedEndTime) {
                resolvedEndTime = tt.finishTime?.toDate ? formatTime(tt.finishTime.toDate()) : tt.finishTime;
            }
        }
    }

    // Auto-calculate end time if only start provided
    if (resolvedStartTime && !resolvedEndTime) {
        const startMins = parseTimeToMinutes(resolvedStartTime);
        if (startMins !== null) {
            resolvedEndTime = formatMinutesToTime(startMins + 45);
            source = 'auto_calculated';
        }
    }

    // Collision check
    if (resolvedStartTime && resolvedEndTime) {
        const startMins = parseTimeToMinutes(resolvedStartTime);
        const endMins = parseTimeToMinutes(resolvedEndTime);

        for (const [key, tt] of Object.entries(timetableMap)) {
            const match = key.match(/^lesson(\d+)$/);
            if (!match) continue;
            const slotNum = parseInt(match[1]);
            if (slotNum === lessonNumber) continue;

            const slotStart = tt.startTime?.toDate ? parseTimeToMinutes(formatTime(tt.startTime.toDate())) : parseTimeToMinutes(tt.startTime);
            const slotEnd = tt.finishTime?.toDate ? parseTimeToMinutes(formatTime(tt.finishTime.toDate())) : parseTimeToMinutes(tt.finishTime);

            if (slotStart === null || slotEnd === null) continue;

            // Check overlap
            if (startMins < slotEnd && endMins > slotStart) {
                collision = { lessonNumber: slotNum, startTime: formatMinutesToTime(slotStart), endTime: formatMinutesToTime(slotEnd) };
                if (startMins < slotStart && endMins > slotStart) {
                    // We overlap the START of another slot - cap our end
                    resolvedEndTime = formatMinutesToTime(slotStart);
                    warningMessage = `Az óra időtartama csökkentve, mert ütközne a(z) ${slotNum}. órával.`;
                } else {
                    warningMessage = `Figyelem: A kiválasztott időpont ütközik a(z) ${slotNum}. óra beosztásával.`;
                }
                break;
            }
        }
    }

    return { valid: true, startTime: resolvedStartTime, endTime: resolvedEndTime, source, collision, warning: warningMessage };
}

async function handleSaveLessonAssignment(request) {
    const uid = request.auth.uid;
    const data = request.data;
    const sessionId = data.sessionId || ''; // Accept sessionId from client
    const batch = db.batch();
    let opCount = 0;

    if (data.lessons) {
        console.log('[Calendar] Saving payload:', JSON.stringify(data.lessons));
        console.log('[Calendar] SessionId:', sessionId);
        for (const [dayKey, dayLessons] of Object.entries(data.lessons)) {
            if (!['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(dayKey)) continue;
            const dayColRef = db.collection('temp').doc(uid).collection('youhub').doc('timetable').collection(dayKey);
            for (const [lessonNum, lData] of Object.entries(dayLessons)) {
                const docRef = dayColRef.doc(`lesson${lessonNum}`);
                if (!lData) {
                    batch.delete(docRef);
                } else {
                    const hasOptionalStudents = lData.optionalLessonStudents && typeof lData.optionalLessonStudents === 'string' && lData.optionalLessonStudents.trim().length > 0;
                    const optionalClass = lData.optionalClass === true || hasOptionalStudents;
                    batch.set(docRef, {
                        lessonTitle: lData.lessonTypeName || lData.lessonType || '',
                        teacherTitle: lData.teacherName || lData.teacher || '',
                        startTime: lData.startTime || lData.timelineStart || '',
                        finishTime: lData.endTime || lData.timelineEnd || '',
                        lessonType: lData.lessonType || '',
                        teacher: lData.teacher || '',
                        teacher2: lData.teacher2 || null,
                        studentGroup: lData.studentGroupId || lData.studentGroup || null, // Prefer ID
                        studentGroupName: lData.studentGroupName || lData.studentGroup || null, // Display name
                        placeid: lData.placeid || null,
                        placeName: lData.placeName || null,
                        optionalLessonStudents: lData.optionalLessonStudents || null,
                        optionalClass: optionalClass,
                        sessionId: sessionId,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
                opCount++;
            }
        }
    }
    if (opCount > 0) await batch.commit();
    return { success: true };
}

async function handleGetModifiedDays(request) {
    const uid = request.auth.uid;
    const timetableRef = db.collection('temp').doc(uid).collection('youhub').doc('timetable');
    const collections = await timetableRef.listCollections();
    const days = collections.map(col => col.id).filter(id => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(id));
    const validDays = [];
    for (const day of days) {
        const snap = await timetableRef.collection(day).limit(1).get();
        if (!snap.empty) validDays.push(day);
    }
    return { days: validDays };
}

async function handleGetLessonCards(request) {
    const uid = request.auth.uid;
    const clientSessionId = request.data.sessionId; // SessionId from client
    let selectedDay = request.data.day;
    if (!selectedDay) {
        const sessionDoc = await db.collection(SESSION_COLLECTION).doc(uid).get();
        selectedDay = sessionDoc.exists ? sessionDoc.data().selectedDay : 'monday';
    }
    if (!selectedDay) return { cards: [] };

    const dayColRef = db.collection('temp').doc(uid).collection('youhub').doc('timetable').collection(selectedDay);
    const snapshot = await dayColRef.get();

    // Check if data is stale (different sessionId)
    let isStale = false;
    if (clientSessionId && !snapshot.empty) {
        const firstDoc = snapshot.docs[0].data();
        if (firstDoc.sessionId && firstDoc.sessionId !== clientSessionId) {
            console.log(`[Calendar] Stale data detected: stored=${firstDoc.sessionId}, client=${clientSessionId}`);
            isStale = true;
            // Clear stale data
            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.set(doc.ref, {
                    lessonType: '', lessonTitle: '', teacher: '', teacherTitle: '',
                    teacher2: '', studentGroup: '', studentGroupName: '',
                    placeid: '', placeName: '',
                    startTime: '', finishTime: '', sessionId: ''
                });
            });
            await batch.commit();
            console.log(`[Calendar] Cleared ${snapshot.size} stale lessons`);
        }
    }

    if (isStale) {
        // Return empty normalized cards
        const normalizedCards = [];
        for (let i = 0; i <= 8; i++) {
            normalizedCards.push({ number: i, typeName: '-', teacher: '-', timeline: '-', complete: false });
        }
        return { cards: normalizedCards, cleared: true };
    }

    const cards = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        const num = parseInt(doc.id.replace('lesson', ''));
        if (!isNaN(num)) {
            cards.push({
                number: num,
                typeName: d.lessonTitle || '-',
                teacher: d.teacherTitle || '-',
                teacher2: d.teacher2 || null,
                studentGroup: d.studentGroup || null,
                studentGroupName: d.studentGroupName || null,
                placeid: d.placeid || null,
                placeName: d.placeName || '-',
                timeline: (d.startTime && d.finishTime) ? `${d.startTime} - ${d.finishTime}` : '-',
                complete: !!(d.lessonType && d.teacher && d.startTime),
                lessonType: d.lessonType,
                teacherId: d.teacher,
                startTime: d.startTime,
                finishTime: d.finishTime,
                optionalClass: d.optionalClass === true // Load optionalClass boolean
            });
        }
    });

    const normalizedCards = [];
    for (let i = 0; i <= 8; i++) {
        const found = cards.find(c => c.number === i);        normalizedCards.push(found || { number: i, typeName: '-', teacher: '-', timeline: '-', complete: false, optionalClass: false });
    }
    return { cards: normalizedCards };
}

async function handleGetClassTimetableCards(request) {
    const { classId, day } = request.data;
    if (!classId || !day) {
        throw new HttpsError('invalid-argument', 'classId and day are required');
    }

    const dayColRef = db.collection('classes').doc(classId)
        .collection('calendar').doc('timetable').collection(day);
    const snapshot = await dayColRef.get();

    const cards = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        const num = parseInt(doc.id.replace('lesson', ''), 10);
        if (!isNaN(num)) {
            cards.push({
                number: num,
                lessonType: d.lessonType || null,
                lessonTypeName: d.lessonTypeName || d.lessonType || '-',
                lessonIcon: d.lessonIcon || 'smile',
                teacherId: d.teacherId || d.teacher || null,
                teacherName: d.teacherName || '-',
                teacher2: d.teacher2 || null,
                teacher2Name: d.teacher2Name || null,
                studentGroup: d.studentGroup || null,
                studentGroupName: d.studentGroupName || null,
                placeName: d.placeName || '-',
                timelineStart: d.timelineStart || null,
                timelineEnd: d.timelineEnd || null,
                optionalClass: d.optionalClass === true,
                optionalLessonStudents: d.optionalLessonStudents || null
            });
        }
    });

    cards.sort((a, b) => a.number - b.number);
    return { cards };
}

async function handleDeleteClassTimetableLesson(request) {
    const uid = request.auth.uid;
    const token = request.auth.token;
    const isAuthorized = token.admin === true || token.teacher === true || token.owner === true;
    if (!isAuthorized) {
        throw new HttpsError('permission-denied', 'Admin, teacher or owner access required');
    }

    const { classId, day, lessonNumber } = request.data;
    if (!classId || !day || lessonNumber === undefined || lessonNumber === null) {
        throw new HttpsError('invalid-argument', 'classId, day and lessonNumber are required');
    }

    const lessonNum = parseInt(lessonNumber, 10);
    if (Number.isNaN(lessonNum)) {
        throw new HttpsError('invalid-argument', 'lessonNumber must be a number');
    }

    const docRef = db.collection('classes').doc(classId)
        .collection('calendar').doc('timetable').collection(day)
        .doc(`lesson${lessonNum}`);

    await docRef.delete();
    console.log(`[CalendarAPI] Deleted lesson${lessonNum} from ${classId}/${day} by ${uid}`);
    return { success: true };
}

async function handleSaveVariation(request) {
    const uid = request.auth.uid;
    const { lessonNumber, lessonType, teacher, repeatRule, dateSequence } = request.data;
    if (!/^(week|month)_\d+$/.test(repeatRule)) {
        throw new HttpsError('invalid-argument', 'Invalid repeat rule format');
    }
    let startDate = null, endDate = null;
    if (dateSequence) {
        const parts = dateSequence.split(' - ');
        if (parts.length === 1) endDate = parts[0].trim().replace(/\./g, '-');
        else if (parts.length === 2) {
            startDate = parts[0].trim().replace(/\./g, '-');
            endDate = parts[1].trim().replace(/\./g, '-');
        }
    }
    const sessionDoc = await db.collection(SESSION_COLLECTION).doc(uid).get();
    if (!sessionDoc.exists) throw new HttpsError('failed-precondition', 'Session not found');
    const sessionData = sessionDoc.data();
    const variations = sessionData.variations || {};
    const key = `${sessionData.selectedDay}_${lessonNumber}`;
    variations[key] = { lessonNumber, day: sessionData.selectedDay, lessonType, teacher, repeatRule, startDate, endDate };
    await db.collection(SESSION_COLLECTION).doc(uid).update({ variations });
    return { success: true };
}

async function handleGetVariationPreview(request) {
    const { repeatRule, dateSequence } = request.data;
    if (!repeatRule || !dateSequence) {
        throw new HttpsError('invalid-argument', 'Missing repeatRule or dateSequence');
    }
    const settingsDoc = await db.collection('settings').doc('schoolYear').get();
    if (!settingsDoc.exists) throw new HttpsError('failed-precondition', 'School year settings not found');
    const { firstDay } = settingsDoc.data();
    if (!firstDay) throw new HttpsError('failed-precondition', 'First day not configured');

    const parts = dateSequence.split(' - ');
    let start, end;
    if (parts.length === 1) {
        start = firstDay.toDate ? firstDay.toDate() : parseISO(firstDay);
        end = parseISO(parts[0].trim().replace(/\./g, '-'));
    } else {
        start = parseISO(parts[0].trim().replace(/\./g, '-'));
        end = parseISO(parts[1].trim().replace(/\./g, '-'));
    }

    const affectedDates = [];
    const [type, countStr] = repeatRule.split('_');
    const count = parseInt(countStr);

    if (type === 'week') {
        const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
        weeks.forEach((weekStart, index) => {
            if ((index + 1) % count === 0) affectedDates.push(format(weekStart, 'yyyy-MM-dd'));
        });
    } else if (type === 'month') {
        const months = eachMonthOfInterval({ start, end });
        months.forEach((monthStart, index) => {
            if ((index + 1) % count === 0) affectedDates.push(format(monthStart, 'yyyy-MM'));
        });
    }
    return { affectedDates, totalCount: affectedDates.length };
}

async function handleGetSessionData(request) {
    const uid = request.auth.uid;
    const dayNames = { monday: 'Hétfő', tuesday: 'Kedd', wednesday: 'Szerda', thursday: 'Csütörtök', friday: 'Péntek' };
    const sessionDoc = await db.collection(SESSION_COLLECTION).doc(uid).get();
    if (!sessionDoc.exists) return { hasSession: false };
    const data = sessionDoc.data();
    return {
        hasSession: true,
        className: data.selectedClassName,
        classId: data.selectedClassId,
        day: data.selectedDay,
        dayName: dayNames[data.selectedDay],
        hour: data.selectedHour,
        hourLabel: `${data.selectedHour}. óra`
    };
}

async function handleSearchUsers(request) {
    // Structure: usrlookup/names/{normalizedName}/{uid} with fullName field
    // Example: usrlookup/names/besenyei_igor/lCYMH8Yjusa0m3Rio1Rl9zXmSOf1

    const namesDocRef = db.collection('usrlookup').doc('names');
    const collections = await namesDocRef.listCollections();

    const users = [];
    for (const col of collections) {
        const normalizedName = col.id;
        // Get first document in this collection (the user data)
        const docsSnapshot = await col.limit(1).get();
        if (!docsSnapshot.empty) {
            const doc = docsSnapshot.docs[0];
            const data = doc.data();
            if (data.fullName) {
                users.push({
                    id: doc.id,
                    normalizedName: normalizedName,
                    fullName: data.fullName
                });
            }
        }
    }

    console.log(`[CalendarAPI] searchUsers: Found ${users.length} users`);
    return { users };
}

async function handleSearchTeacherCandidates(request) {
    // Return combined teacher + name lookup candidates
    const results = [];
    const seen = new Set();

    const teachersRoot = db.collection('usrlookup').doc('teachers');
    const teacherCollections = await teachersRoot.listCollections();
    for (const col of teacherCollections) {
        const normalizedName = col.id;
        const docsSnapshot = await col.limit(1).get();
        if (!docsSnapshot.empty) {
            const doc = docsSnapshot.docs[0];
            const data = doc.data();
            if (data.fullName && !seen.has(normalizedName)) {
                results.push({
                    id: doc.id,
                    normalizedName,
                    fullName: data.fullName,
                    source: 'teachers'
                });
                seen.add(normalizedName);
            }
        }
    }

    const namesRoot = db.collection('usrlookup').doc('names');
    const nameCollections = await namesRoot.listCollections();
    for (const col of nameCollections) {
        const normalizedName = col.id;
        if (seen.has(normalizedName)) continue;
        const docsSnapshot = await col.limit(1).get();
        if (!docsSnapshot.empty) {
            const doc = docsSnapshot.docs[0];
            const data = doc.data();
            if (data.fullName) {
                results.push({
                    id: doc.id,
                    normalizedName,
                    fullName: data.fullName,
                    source: 'names'
                });
                seen.add(normalizedName);
            }
        }
    }

    console.log(`[CalendarAPI] searchTeacherCandidates: Found ${results.length} users`);
    return { users: results };
}

async function handleGrantClassAccess(request) {
    const uid = request.auth.uid;
    const token = request.auth.token;
    const isAuthorized = token.admin === true || token.teacher === true || token.owner === true;
    if (!isAuthorized) {
        throw new HttpsError('permission-denied', 'Admin, teacher or owner access required');
    }

    const { fullName, roles } = request.data;
    if (!fullName || typeof fullName !== 'string') {
        throw new HttpsError('invalid-argument', 'fullName is required');
    }
    if (!roles || typeof roles !== 'object') {
        throw new HttpsError('invalid-argument', 'roles are required');
    }

    const ownClassDoc = await db.collection('users').doc(uid).collection('groups').doc('ownclass').get();
    if (!ownClassDoc.exists) {
        throw new HttpsError('failed-precondition', 'Own class not found');
    }
    const ownData = ownClassDoc.data() || {};
    const classFinishes = (ownData.classFinishes || '').toString().trim();
    const classType = (ownData.classType || '').toString().trim().toLowerCase();
    if (!classFinishes || !classType) {
        throw new HttpsError('failed-precondition', 'Own class data missing');
    }

    // Non-admin/owner can only grant for own class
    if (!(token.admin === true || token.owner === true)) {
        const classId = `${classFinishes}${classType}`.toLowerCase();
        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) {
            throw new HttpsError('failed-precondition', 'Own class not found in classes');
        }
    }

    // Normalize name (same as optional lookup)
    const normalizedName = fullName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '_');

    let targetUserId = null;
    // Try teachers first
    const teachersCol = db.collection('usrlookup').doc('teachers').collection(normalizedName);
    const teachersSnap = await teachersCol.limit(1).get();
    if (!teachersSnap.empty) {
        targetUserId = teachersSnap.docs[0].id;
    } else {
        // Fallback to names
        const namesCol = db.collection('usrlookup').doc('names').collection(normalizedName);
        const namesSnap = await namesCol.limit(1).get();
        if (!namesSnap.empty) {
            targetUserId = namesSnap.docs[0].id;
        }
    }

    if (!targetUserId) {
        throw new HttpsError('not-found', 'User not found for provided name');
    }

    await db.collection('users').doc(targetUserId).collection('groups').doc('permittedClass').set({
        classFinishes: classFinishes,
        classType: classType,
        homeroomDeputy: roles.homeroomDeputy === true,
        subjectTeacher: roles.subjectTeacher === true,
        substituteTeacher: roles.substituteTeacher === true,
        adminColleague: roles.adminColleague === true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        grantedBy: uid
    }, { merge: true });

    return { success: true, targetUserId };
}

async function handleLookupOptionalLessonStudents(request) {
    // Look up students by fullName and return normalizedNames
    // Input: { fullNames: "Name1, Name2, Name3" } (comma-separated string)
    // Output: { normalizedNames: "name1, name2, name3" } or null if empty/not found
    
    const { fullNames } = request.data;
    
    if (!fullNames || typeof fullNames !== 'string') {
        return { normalizedNames: null };
    }
    
    // Parse names: split by comma and trim
    const nameArray = fullNames.split(',').map(n => n.trim()).filter(n => n);
    
    if (nameArray.length === 0) {
        return { normalizedNames: null };
    }
    
    // Helper function to simplify name (convert to normalizedName format)
    function simplifyName(fullName) {
        return fullName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/[^a-z0-9\s]/g, '') // Remove special chars
            .trim()
            .replace(/\s+/g, '_'); // Replace spaces with underscores
    }
    
    const foundNormalizedNames = [];
    
    for (const fullName of nameArray) {
        const normalizedName = simplifyName(fullName);
        
        try {
            // Look up in usrlookup/names/{normalizedName}/{userId}
            const namesCollectionRef = db.collection('usrlookup').doc('names').collection(normalizedName);
            const userDocs = await namesCollectionRef.limit(1).get();
            
            if (!userDocs.empty) {
                // Found - add normalizedName
                foundNormalizedNames.push(normalizedName);
                console.log(`[CalendarAPI] Found student: ${fullName} -> ${normalizedName}`);
            } else {
                console.log(`[CalendarAPI] Student not found: ${fullName} (${normalizedName})`);
            }
        } catch (error) {
            console.error(`[CalendarAPI] Error looking up name ${fullName}:`, error);
        }
    }
    
    // Return comma-separated string or null
    if (foundNormalizedNames.length > 0) {
        return { normalizedNames: foundNormalizedNames.join(', ') };
    } else {
        return { normalizedNames: null };
    }
}

async function handleGetOptionalLessonStudents(request) {
    // Get fullNames for normalizedNames
    // Input: { normalizedNames: "name1, name2, name3" } (comma-separated string)
    // Output: { fullNames: ["Full Name 1", "Full Name 2", "Full Name 3"] } or []
    
    const { normalizedNames } = request.data;
    
    if (!normalizedNames || typeof normalizedNames !== 'string') {
        return { fullNames: [] };
    }
    
    // Parse normalizedNames: split by comma and trim
    const normalizedNameArray = normalizedNames.split(',').map(n => n.trim()).filter(n => n);
    
    if (normalizedNameArray.length === 0) {
        return { fullNames: [] };
    }
    
    const fullNames = [];
    
    for (const normalizedName of normalizedNameArray) {
        try {
            // Look up in usrlookup/names/{normalizedName}/{userId}
            const namesCollectionRef = db.collection('usrlookup').doc('names').collection(normalizedName);
            const userDocs = await namesCollectionRef.limit(1).get();
            
            if (!userDocs.empty) {
                const userDoc = userDocs.docs[0];
                const userData = userDoc.data();
                const fullName = userData.fullName || normalizedName;
                fullNames.push(fullName);
                console.log(`[CalendarAPI] Found fullName: ${normalizedName} -> ${fullName}`);
            } else {
                console.log(`[CalendarAPI] FullName not found for: ${normalizedName}`);
            }
        } catch (error) {
            console.error(`[CalendarAPI] Error looking up normalizedName ${normalizedName}:`, error);
        }
    }
    
    return { fullNames };
}

async function handleGetCurrentUserNormalizedName(request) {
    // Get current user's normalizedName from usrlookup/names
    const uid = request.auth.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    try {
        // Look up in usrlookup/names - find collection where userId matches
        const namesDocRef = db.collection('usrlookup').doc('names');
        const collections = await namesDocRef.listCollections();
        
        for (const col of collections) {
            const userDoc = await col.doc(uid).get();
            if (userDoc.exists) {
                console.log(`[CalendarAPI] Found normalizedName for user ${uid}: ${col.id}`);
                return { normalizedName: col.id };
            }
        }
        
        console.log(`[CalendarAPI] No normalizedName found for user ${uid}`);
        return { normalizedName: null };
    } catch (error) {
        console.error(`[CalendarAPI] Error getting normalizedName for user ${uid}:`, error);
        throw new HttpsError('internal', `Failed to get normalizedName: ${error.message}`);
    }
}

async function handleGenerateSessionId(request) {
    // Generate unique session ID for this calendar editing session
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[CalendarAPI] Generated sessionId: ${sessionId}`);
    return { sessionId };
}

async function handleClearTempLessons(request) {
    const uid = request.auth.uid;
    const { day } = request.data;

    if (!day) {
        throw new HttpsError('invalid-argument', 'Day is required');
    }

    const dayDocRef = db.collection('temp').doc(uid)
        .collection('youhub').doc('timetable')
        .collection(day);

    const lessonsSnapshot = await dayDocRef.get();

    const batch = db.batch();
    lessonsSnapshot.docs.forEach(doc => {
        // Clear fields but don't delete document
        batch.set(doc.ref, {
            lessonType: '',
            lessonTitle: '',
            teacher: '',
            teacherTitle: '',
            teacher2: '',
            studentGroup: '',
            placeid: '',
            placeName: '',
            startTime: '',
            finishTime: '',
            sessionId: ''
        });
    });

    await batch.commit();
    console.log(`[CalendarAPI] Cleared ${lessonsSnapshot.size} lessons for ${day}`);
    return { cleared: lessonsSnapshot.size };
}

async function handleLoadPlaces(request) {
    // Load places from places/placeids/{placeid}/place structure
    // Structure: places (root collection) -> placeids (document) -> a1, a2, etc. (collections) -> place (document)
    console.log('[CalendarAPI] Loading places...');
    
    const places = [];
    
    try {
        // Get the placeids document
        const placeidsDocRef = db.collection('places').doc('placeids');
        
        // List all collections under placeids document (e.g., a1, a2, etc.)
        const collections = await placeidsDocRef.listCollections();
        
        for (const collection of collections) {
            const placeid = collection.id; // e.g., "a1"
            
            // Get the 'place' document within this collection
            const placeDocRef = collection.doc('place');
            const placeDoc = await placeDocRef.get();
            
            if (placeDoc.exists) {
                const data = placeDoc.data();
                const placeName = data.name || placeid;
                
                places.push({
                    placeid: placeid,
                    name: placeName
                });
            }
        }
        
        // Sort by name
        places.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
        
        console.log(`[CalendarAPI] Loaded ${places.length} places`);
        return { places };
        
    } catch (e) {
        console.error('[CalendarAPI] Error loading places:', e);
        throw new HttpsError('internal', `Failed to load places: ${e.message}`);
    }
}

async function handlePublishTimetable(request) {
    const uid = request.auth.uid;
    const { classId } = request.data;

    if (!classId) {
        throw new HttpsError('invalid-argument', 'classId is required');
    }

    console.log(`[CalendarAPI] publishTimetable: classId=${classId}`);

    // Get all temp data for this user
    const timetableRef = db.collection('temp').doc(uid).collection('youhub').doc('timetable');
    const collections = await timetableRef.listCollections();
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

    // Cache for teachers, lessons, and places to avoid repeated lookups
    const teacherCache = {};
    const lessonCache = {};
    const placeCache = {};

    const fetchTeacher = async (normalizedName) => {
        if (!normalizedName) return { fullName: '-' };
        if (teacherCache[normalizedName]) return teacherCache[normalizedName];
        
        try {
            // First try: /usrlookup/teachers/{normalizedName} collection
            const teachersColRef = db.collection('usrlookup').doc('teachers').collection(normalizedName);
            const teachersSnap = await teachersColRef.limit(1).get();
            
            if (!teachersSnap.empty) {
                const doc = teachersSnap.docs[0];
                const data = doc.data();
                if (data.fullName) {
                    teacherCache[normalizedName] = { fullName: data.fullName };
                    console.log(`[CalendarAPI] Found teacher: ${normalizedName} -> ${data.fullName}`);
                    return teacherCache[normalizedName];
                }
            }
            
            // Second try: /usrlookup/names/{normalizedName} collection (for students/others)
            const namesColRef = db.collection('usrlookup').doc('names').collection(normalizedName);
            const namesSnap = await namesColRef.limit(1).get();
            
            if (!namesSnap.empty) {
                const doc = namesSnap.docs[0];
                const data = doc.data();
                if (data.fullName) {
                    teacherCache[normalizedName] = { fullName: data.fullName };
                    console.log(`[CalendarAPI] Found name: ${normalizedName} -> ${data.fullName}`);
                    return teacherCache[normalizedName];
                }
            }
            
            console.warn(`[CalendarAPI] Teacher not found: ${normalizedName}`);
        } catch (e) {
            console.error(`[CalendarAPI] Error fetching teacher ${normalizedName}:`, e);
        }
        
        // Fallback: return normalizedName as-is
        teacherCache[normalizedName] = { fullName: normalizedName };
        return { fullName: normalizedName };
    };

    const fetchLesson = async (lessonId) => {
        if (!lessonId) return { name: 'Ismeretlen óra', icon: 'smile' };
        if (lessonCache[lessonId]) return lessonCache[lessonId];
        try {
            const snap = await db.collection('lessons').doc(lessonId).get();
            if (snap.exists) {
                lessonCache[lessonId] = snap.data();
                return lessonCache[lessonId];
            }
        } catch (e) {
            console.warn(`[CalendarAPI] Error fetching lesson ${lessonId}:`, e);
        }
        return { name: lessonId, icon: 'smile' };
    };

    const fetchPlace = async (placeid) => {
        if (!placeid) return null;
        if (placeCache[placeid]) return placeCache[placeid];
        try {
            const snap = await db.collection('places').doc('placeids').collection(placeid).doc('place').get();
            if (snap.exists) {
                const data = snap.data();
                placeCache[placeid] = data.name || placeid;
                return placeCache[placeid];
            }
        } catch (e) {
            console.warn(`[CalendarAPI] Error fetching place ${placeid}:`, e);
        }
        return placeid; // Return placeid as fallback
    };

    const batch = db.batch();
    let totalLessons = 0;

    for (const col of collections) {
        const dayName = col.id;
        if (!days.includes(dayName)) continue;

        const lessonsSnapshot = await col.get();

        // Filter only complete lessons and enrich with teacher/lesson data
        const completeLessons = [];
        for (const doc of lessonsSnapshot.docs) {
            const d = doc.data();
            // Check if lesson is complete (has type, teacher, and time)
            if (d.lessonType && d.teacher && d.startTime && d.finishTime) {
                // Fetch teacher, lesson, and place details
                const teacherData = await fetchTeacher(d.teacher);
                const teacher2Data = d.teacher2 ? await fetchTeacher(d.teacher2) : null;
                const lessonData = await fetchLesson(d.lessonType);
                const placeName = d.placeid ? await fetchPlace(d.placeid) : (d.placeName || d.room || null);

                const lessonObj = {
                    id: doc.id, // Keep the original ID (e.g., lesson0, lesson6)
                    lessonType: d.lessonType,
                    lessonTypeName: lessonData.name || d.lessonType,
                    lessonIcon: lessonData.icon || 'smile',
                    teacherId: d.teacher, // Save the ID for client-side lookups
                    teacherName: teacherData.fullName || teacherData.name || d.teacher, // Resolved full name
                    teacher2: d.teacher2 || null,
                    teacher2Name: teacher2Data ? (teacher2Data.fullName || teacher2Data.name || d.teacher2) : null,
                    studentGroup: d.studentGroup || null,
                    studentGroupName: d.studentGroupName || null,
                    placeName: placeName, // Resolved place name (no placeid or room in published data)
                    timelineStart: d.startTime,
                    timelineEnd: d.finishTime
                };
                
                // Add optionalClass boolean and optionalLessonStudents
                if (d.optionalClass === true) {
                    lessonObj.optionalClass = true;
                }
                if (d.optionalLessonStudents && typeof d.optionalLessonStudents === 'string' && d.optionalLessonStudents.trim().length > 0) {
                    lessonObj.optionalClass = true;
                    lessonObj.optionalLessonStudents = d.optionalLessonStudents; // Keep the normalizedNames for client-side checking
                }
                
                completeLessons.push(lessonObj);
            }
        }

        // Sort lessons by start time
        completeLessons.sort((a, b) => {
            return a.timelineStart.localeCompare(b.timelineStart);
        });

        // Save to classes/{classId}/calendar/timetable/{day}/lesson{N}
        const classCalendarRef = db.collection('classes').doc(classId)
            .collection('calendar').doc('timetable').collection(dayName);

        // Add/overwrite complete lessons using their original IDs (lesson0, lesson6 etc.)
        completeLessons.forEach((lesson) => {
            const docRef = classCalendarRef.doc(lesson.id);
            batch.set(docRef, {
                ...lesson,
                publishedAt: admin.firestore.FieldValue.serverTimestamp(),
                publishedBy: uid
            });
            totalLessons++;
        });

        console.log(`[CalendarAPI] ${dayName}: ${completeLessons.length} complete lessons`);
    }

    await batch.commit();
    console.log(`[CalendarAPI] Published ${totalLessons} lessons to class ${classId}`);

    // Clear temp data after successful publish
    const clearBatch = db.batch();
    for (const col of collections) {
        const lessonsSnapshot = await col.get();
        lessonsSnapshot.forEach(doc => {
            clearBatch.delete(doc.ref);
        });
    }
    await clearBatch.commit();
    console.log(`[CalendarAPI] Cleared temp data`);

    return { success: true, totalLessons };
}

// ========== EXAM PUBLISHING ==========

async function handlePublishExam(request) {
    const uid = request.auth.uid;
    const token = request.auth.token;

    // Check custom claims for authorization
    const isAuthorized = token.admin === true || token.teacher === true || token.owner === true;
    if (!isAuthorized) {
        throw new HttpsError('permission-denied', 'Admin, teacher or owner access required');
    }

    const { classId, dayName, lessonType, examType, examDate } = request.data;
    
    if (!classId || !dayName || !lessonType || !examType || !examDate) {
        throw new HttpsError('invalid-argument', 'Missing required fields: classId, dayName, lessonType, examType, examDate');
    }

    console.log(`[CalendarAPI] Publishing exam for class ${classId}, day ${dayName}`);
    console.log(`[CalendarAPI] Exam details: lessonType=${lessonType}, examType=${examType}, examDate=${examDate}`);

    // Fetch lesson data for icon and name
    const lessonRef = db.collection('lessons').doc(lessonType);
    const lessonSnap = await lessonRef.get();
    const lessonData = lessonSnap.exists ? lessonSnap.data() : { name: lessonType, icon: 'smile' };

    // Get or create exams document and latestId
    const examsRef = db.collection('classes').doc(classId).collection('calendar').doc('exams');
    const examsDoc = await examsRef.get();
    
    let latestId = 0;
    if (examsDoc.exists && examsDoc.data().latestId) {
        latestId = parseInt(examsDoc.data().latestId) || 0;
    }
    
    const newExamId = latestId + 1;
    const examDocId = `exam${newExamId}`;
    
    console.log(`[CalendarAPI] Creating ${examDocId} (latestId was ${latestId})`);

    // Parse exam date
    let examTimestamp;
    try {
        examTimestamp = admin.firestore.Timestamp.fromDate(new Date(examDate));
    } catch (e) {
        throw new HttpsError('invalid-argument', 'Invalid examDate format');
    }

    // Create the exam document in /classes/{classId}/calendar/exams/{dayName}/exam{id}
    const dayRef = examsRef.collection(dayName).doc(examDocId);
    
    const examObj = {
        examId: newExamId,
        examType: examType, // temazaro, ropdolgozat, feleles, prezentacio
        lessonType: lessonType,
        lessonTypeName: lessonData.name || lessonType,
        lessonIcon: lessonData.icon || 'smile',
        examDate: examTimestamp,
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        publishedBy: uid
    };

    const batch = db.batch();
    
    // Set the exam document
    batch.set(dayRef, examObj);
    
    // Update latestId in exams document
    batch.set(examsRef, { latestId: newExamId.toString() }, { merge: true });
    
    await batch.commit();
    
    console.log(`[CalendarAPI] Published exam ${examDocId} to class ${classId}/${dayName}`);

    return { success: true, examId: newExamId, examDocId };
}

async function handleGetExamCards(request) {
    const uid = request.auth.uid;
    const { classId, dayName } = request.data;

    if (!classId || !dayName) {
        throw new HttpsError('invalid-argument', 'Missing classId or dayName');
    }

    console.log(`[CalendarAPI] Getting exam cards for class ${classId}, day ${dayName}`);

    const examsRef = db.collection('classes').doc(classId)
        .collection('calendar').doc('exams').collection(dayName);
    
    const snapshot = await examsRef.orderBy('examDate', 'asc').get();
    
    const exams = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        exams.push({
            id: doc.id,
            ...data,
            examDate: data.examDate ? data.examDate.toDate().toISOString() : null
        });
    });

    console.log(`[CalendarAPI] Found ${exams.length} exams for ${dayName}`);
    return { exams };
}

// ========== SINGLE EXPORTED API ==========

const actionHandlers = {
    loadClasses: handleLoadClasses,
    selectClass: handleSelectClass,
    selectTimeSlot: handleSelectTimeSlot,
    loadLessonTypes: handleLoadLessonTypes,
    loadTeachers: handleLoadTeachers,
    loadPlaces: handleLoadPlaces,
    validateTimeline: handleValidateTimeline,
    saveLessonAssignment: handleSaveLessonAssignment,
    getModifiedDays: handleGetModifiedDays,
    getLessonCards: handleGetLessonCards,
    getClassTimetableCards: handleGetClassTimetableCards,
    deleteClassTimetableLesson: handleDeleteClassTimetableLesson,
    saveVariation: handleSaveVariation,
    getVariationPreview: handleGetVariationPreview,
    getSessionData: handleGetSessionData,
    searchUsers: handleSearchUsers,
    lookupOptionalLessonStudents: handleLookupOptionalLessonStudents,
    getOptionalLessonStudents: handleGetOptionalLessonStudents,
    getCurrentUserNormalizedName: handleGetCurrentUserNormalizedName,
    searchTeacherCandidates: handleSearchTeacherCandidates,
    grantClassAccess: handleGrantClassAccess,
    generateSessionId: handleGenerateSessionId,
    clearTempLessons: handleClearTempLessons,
    publishTimetable: handlePublishTimetable,
    publishExam: handlePublishExam,
    getExamCards: handleGetExamCards
};

exports.calendarApi = onCall(runtimeOpts, async (request) => {
    try {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be authenticated');
        }

        // Global rate limiting (failsafe)
        await checkGlobalRateLimit(request.auth.uid, 'calendarApi');

        const { action } = request.data;
        if (!action || !actionHandlers[action]) {
            throw new HttpsError('invalid-argument', `Unknown action: ${action}`);
        }

        console.log(`[CalendarAPI] Action: ${action}, UID: ${request.auth.uid}`);
        return await actionHandlers[action](request);

    } catch (error) {
        console.error('[CalendarAPI] Error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', error.message || 'Internal error');
    }
});

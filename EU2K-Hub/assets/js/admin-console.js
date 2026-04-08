// Admin Console Script for YouHub
// Allows syncing user data from users/{userId} to public/users/nevek/{userId}

const ADMIN_CONSOLE_KEY = 'eu2k-admin-console';
let sessionCheckInterval = null;
let confirmationTimeouts = new Map();

// User search logic (based on youhub suggestions)
let userSuggestions = [];
let userSuggestionsLoaded = false;

// Helper function to get translation
function getTranslation(key, fallback = '') {
  try {
    if (window.translationManager) {
      const translation = window.translationManager.getTranslation(key);
      if (translation) return translation;
    }
  } catch (e) {
    console.warn('[AdminConsole] Translation error:', e);
  }
  return fallback;
}

// Helper function to show notification using toaster system
// priority: 'positive' (confirmations), 'warning' (missing info), 'danger' (errors, wrong data, deletions)
async function showNotification(message, title = 'Értesítés', priority = 'green') {
  try {
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
    const { doc, setDoc, serverTimestamp, getFirestore } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
    const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
    const auth = getAuth(app);
    const db = window.db || getFirestore(app);

    if (!auth.currentUser) {
      // Fallback to alert if not logged in
      alert(message);
      return;
    }
    const notificationRef = doc(db, `users/${auth.currentUser.uid}/notifs`, Date.now().toString());
    await setDoc(notificationRef, {
      title: title,
      content: message,
      type: 'message',
      priority: priority,
      icon: 'info',
      date: serverTimestamp(),
      action: 'view'
    });
  } catch (error) {
    console.error('[Notification] Failed to create notification:', error);
    // Fallback to alert
    alert(message);
  }
}

function isAdminConsoleEnabled() {
  try {
    return localStorage.getItem(ADMIN_CONSOLE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setAdminConsole(enabled) {
  try {
    localStorage.setItem(ADMIN_CONSOLE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('[AdminConsole] Failed to save admin console state:', e);
  }
}

async function showAdminConsolePopup() {
  console.log('[AdminConsole] showAdminConsolePopup called');
  // Először ellenőrizzük, van-e aktív session
  try {
    console.log('[AdminConsole] Checking session with Firebase function...');
    const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
    const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
    const functions = getFunctions(app, 'europe-west1');
    const checkSession = httpsCallable(functions, 'checkAdminConsoleSession');

    console.log('[AdminConsole] Calling checkAdminConsoleSession...');
    const result = await checkSession();
    console.log('[AdminConsole] Session check response:', result?.data);

    if (result?.data?.valid) {
      console.log('[AdminConsole] Session is valid, opening console');
      // Van aktív session, nyissuk meg közvetlenül
      const data = result.data;
      let timeInfo = '';

      if (data.expiresAt) {
        try {
          const expiresAt = new Date(data.expiresAt);
          const now = new Date();
          const timeRemaining = expiresAt - now;
          if (timeRemaining > 0) {
            const minutesRemaining = Math.floor(timeRemaining / 60000);
            const secondsRemaining = Math.floor((timeRemaining % 60000) / 1000);
            timeInfo = `${minutesRemaining} perc ${secondsRemaining} másodperc`;
          } else {
            timeInfo = 'lejárt';
          }
        } catch (e) {
          timeInfo = 'nem számolható';
        }
      } else if (data.timeRemaining) {
        const minutesRemaining = Math.floor(data.timeRemaining / 60);
        const secondsRemaining = data.timeRemaining % 60;
        timeInfo = `${minutesRemaining} perc ${secondsRemaining} másodperc`;
      }

      if (timeInfo) {
        console.log(`[AdminConsole] Session aktív. Hátralévő idő: ${timeInfo}`);
      } else {
        console.log('[AdminConsole] Session aktív, de hátralévő idő információ nem elérhető');
      }

      // Frissítjük a token-t, hogy az új admin claim érvénybe lépjen
      try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
        const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
        const auth = getAuth(app);
        if (auth.currentUser) {
          await auth.currentUser.getIdToken(true); // Force refresh
          console.log('[AdminConsole] Token refreshed with new admin claim');
        }
      } catch (tokenError) {
        console.warn('[AdminConsole] Token refresh failed:', tokenError);
      }

      setAdminConsole(true);
      showAdminConsole();
      startSessionCheck();
      return;
    } else {
      console.log('[AdminConsole] Session nem érvényes vagy lejárt, jelszó kérése szükséges');
    }
  } catch (error) {
    console.warn('[AdminConsole] Session check failed, showing password popup:', error);
  }

  // Nincs aktív session - ellenőrizzük, van-e jelszó beállítva
  try {
    const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
    const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
    const functions = getFunctions(app, 'europe-west1');
    const checkHasPassword = httpsCallable(functions, 'checkUserHasPassword');

    console.log('[AdminConsole] Checking if user has password...');
    const hasPasswordResult = await checkHasPassword();
    console.log('[AdminConsole] Has password result:', hasPasswordResult?.data);

    if (!hasPasswordResult?.data?.hasPassword) {
      // Nincs jelszó, mutassuk a jelszó létrehozása popup-ot
      console.log('[AdminConsole] No password set, showing create password popup');
      showCreatePasswordPopup();
      return;
    }
  } catch (error) {
    console.warn('[AdminConsole] Check has password failed:', error);
    // Ha hiba van, mutassuk a jelszó popup-ot (lehet hogy nincs még jelszó)
  }

  // Van jelszó, mutassuk a jelszó popup-ot
  const popup = document.getElementById('adminConsolePopup');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup && scrollArea) {
    scrollArea.scrollTop = 0;
    scrollArea.classList.add('no-scroll');
    scrollArea.classList.add('popup-active');
    popup.style.display = 'flex';
    const input = document.getElementById('adminConsolePassword');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
  }
}

function showCreatePasswordPopup() {
  const popup = document.getElementById('createPasswordPopup');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup && scrollArea) {
    scrollArea.scrollTop = 0;
    scrollArea.classList.add('no-scroll');
    scrollArea.classList.add('popup-active');
    popup.style.display = 'flex';
    const input = document.getElementById('createPasswordInput');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
  }
}

function closeCreatePasswordPopup() {
  const popup = document.getElementById('createPasswordPopup');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup) {
    popup.style.display = 'none';
  }
  if (scrollArea) {
    scrollArea.classList.remove('no-scroll');
    scrollArea.classList.remove('popup-active');
  }
}

async function submitCreatePassword() {
  const input = document.getElementById('createPasswordInput');
  if (!input) return;

  const password = input.value;
  if (!password || password.length < 8) {
    const msg = getTranslation('admin.console.messages.password_too_short', 'A jelszónak legalább 8 karakter hosszúnak kell lennie!');
    const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
    await showNotification(msg, title, 'warning');
    return;
  }

  try {
    const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
    const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
    const functions = getFunctions(app, 'europe-west1');
    const createPassword = httpsCallable(functions, 'createUserPassword');

    const result = await createPassword({ password });
    console.log('[AdminConsole] Create password result:', result?.data);

    if (result?.data?.success) {
      console.log('[AdminConsole] Password created successfully');
      // Frissítjük a token-t
      try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
        const auth = getAuth(app);
        if (auth.currentUser) {
          await auth.currentUser.getIdToken(true);
        }
      } catch (tokenError) {
        console.warn('[AdminConsole] Token refresh failed:', tokenError);
      }

      closeCreatePasswordPopup();
      // Most mutassuk a jelszó beírása popup-ot
      const popup = document.getElementById('adminConsolePopup');
      const scrollArea = document.querySelector('.main-scroll-area');
      if (popup && scrollArea) {
        scrollArea.scrollTop = 0;
        scrollArea.classList.add('no-scroll');
        scrollArea.classList.add('popup-active');
        popup.style.display = 'flex';
        const passwordInput = document.getElementById('adminConsolePassword');
        if (passwordInput) {
          passwordInput.value = '';
          setTimeout(() => passwordInput.focus(), 100);
        }
      }
    } else {
      const msg = getTranslation('admin.console.messages.password_create_failed', 'Hiba történt a jelszó létrehozása során.');
      const title = getTranslation('admin.console.status.error', 'Hiba');
      await showNotification(msg, title, 'danger');
    }
  } catch (error) {
    console.error('[AdminConsole] Create password failed:', error);
    const msg = getTranslation('admin.console.messages.password_create_error', 'Hiba történt a jelszó létrehozása során. Próbáld újra.');
    const title = getTranslation('admin.console.status.error', 'Hiba');
    await showNotification(msg, title, 'danger');
  }
}

function closeAdminConsolePopup() {
  const popup = document.getElementById('adminConsolePopup');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup) {
    popup.style.display = 'none';
  }
  if (scrollArea) {
    scrollArea.classList.remove('no-scroll');
    scrollArea.classList.remove('popup-active');
  }
}

async function checkAdminConsolePassword() {
  const input = document.getElementById('adminConsolePassword');
  if (!input) return;

  const password = input.value.trim();
  if (!password) {
    const msg = getTranslation('admin.console.messages.password_required', 'Kérlek add meg a jelszót!');
    const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
    await showNotification(msg, title, 'warning');
    return;
  }

  try {
    const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
    // Use the app from window if available, otherwise get default
    const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
    const functions = getFunctions(app, 'europe-west1');
    const verifyPassword = httpsCallable(functions, 'verifyAdminConsolePassword');

    const result = await verifyPassword({ password });
    console.log('[AdminConsole] Password verification result:', result?.data);

    if (result?.data?.success) {
      // Log session time remaining after successful login
      const data = result.data;
      if (data.expiresAt) {
        const expiresAt = new Date(data.expiresAt);
        const now = new Date();
        const timeRemaining = expiresAt - now;
        const minutesRemaining = Math.floor(timeRemaining / 60000);
        const secondsRemaining = Math.floor((timeRemaining % 60000) / 1000);
        if (timeRemaining > 0) {
          console.log(`[AdminConsole] Bejelentkezés sikeres. Session hátralévő idő: ${minutesRemaining} perc ${secondsRemaining} másodperc`);
        } else {
          console.warn('[AdminConsole] Session lejárt!');
        }
      } else if (data.timeRemaining) {
        const minutesRemaining = Math.floor(data.timeRemaining / 60);
        const secondsRemaining = data.timeRemaining % 60;
        console.log(`[AdminConsole] Bejelentkezés sikeres. Session hátralévő idő: ${minutesRemaining} perc ${secondsRemaining} másodperc`);
      } else {
        console.log('[AdminConsole] Bejelentkezés sikeres (hátralévő idő nem elérhető)');
        if (data && typeof data === 'object') {
          console.log('[AdminConsole] Verification result data keys:', Object.keys(data));
        }
      }
      // Frissítjük a token-t, hogy az új admin claim érvénybe lépjen
      try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
        const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
        const auth = getAuth(app);
        if (auth.currentUser) {
          await auth.currentUser.getIdToken(true); // Force refresh
          console.log('[AdminConsole] Token refreshed with new admin claim');
        }
      } catch (tokenError) {
        console.warn('[AdminConsole] Token refresh failed:', tokenError);
      }

      setAdminConsole(true);
      closeAdminConsolePopup();
      showAdminConsole();
      startSessionCheck();
      console.log('[AdminConsole] Admin console enabled');
    } else {
      const msg = getTranslation('admin.console.messages.wrong_password', 'Hibás jelszó!');
      const title = getTranslation('admin.console.status.wrong_data', 'Hibás adatok');
      await showNotification(msg, title, 'danger');
      input.value = '';
    }
  } catch (error) {
    console.error('[AdminConsole] Password verification failed:', error);
    const msg = getTranslation('admin.console.messages.password_check_error', 'Hiba történt a jelszó ellenőrzése során. Próbáld újra.');
    const title = getTranslation('admin.console.status.error', 'Hiba');
    await showNotification(msg, title, 'danger');
    input.value = '';
  }
}

async function startSessionCheck() {
  // Töröljük a korábbi interval-t, ha van
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
  }

  // Ellenőrizzük a session-t 30 másodpercenként
  sessionCheckInterval = setInterval(async () => {
    try {
      const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
      // Use the app from window if available, otherwise get default
      const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
      const functions = getFunctions(app, 'europe-west1');
      const checkSession = httpsCallable(functions, 'checkAdminConsoleSession');

      const result = await checkSession();

      if (!result.data.valid) {
        // Session lejárt, kijelentkeztetünk
        clearInterval(sessionCheckInterval);
        sessionCheckInterval = null;
        setAdminConsole(false);
        hideAdminConsole();
        // Frissítjük a token-t, hogy az admin claim eltávolításra kerüljön
        try {
          const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
          const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
          const auth = getAuth(app);
          if (auth.currentUser) {
            await auth.currentUser.getIdToken(true); // Force refresh
            console.log('[AdminConsole] Token refreshed after session expiry');
          }
        } catch (tokenError) {
          console.warn('[AdminConsole] Token refresh failed:', tokenError);
        }
        const msg = getTranslation('admin.console.messages.session_expired', 'A munkamenet lejárt. Kérlek jelentkezz be újra.');
        const title = getTranslation('admin.console.status.session_expired', 'Munkamenet lejárt');
        await showNotification(msg, title, 'warning');
      } else {
        // Session érvényes, biztosítjuk hogy a token frissítve van (ha új admin claim lett beállítva)
        try {
          const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
          const app = window.firebaseApp || (await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")).getApp();
          const auth = getAuth(app);
          if (auth.currentUser) {
            await auth.currentUser.getIdToken(true); // Force refresh to get updated claims
          }
        } catch (tokenError) {
          console.warn('[AdminConsole] Token refresh failed:', tokenError);
        }
      }
    } catch (error) {
      console.error('[AdminConsole] Session check failed:', error);
    }
  }, 30000); // 30 másodpercenként ellenőrzés
}

async function syncUserNames() {
  const syncBtn = document.getElementById('adminSyncNamesBtn');
  const statusDiv = document.getElementById('adminSyncNamesStatus');

  if (!syncBtn || !statusDiv) return;

  syncBtn.disabled = true;
  syncBtn.textContent = 'Szinkronizálás...';
  statusDiv.textContent = 'Felhasználók betöltése...';
  statusDiv.style.color = 'var(--text-default-teritary)';

  try {
    const db = window.db;

    if (!db) {
      throw new Error('Firestore database not available. Please refresh the page.');
    }

    const { collection, getDocs, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

    // Read all user documents from users collection
    const usersRef = collection(db, 'users');
    const usersSnap = await getDocs(usersRef);

    if (usersSnap.empty) {
      statusDiv.textContent = getTranslation('admin.console.sync.no_users', 'Nincs felhasználó a users kollekcióban.');
      statusDiv.style.color = 'var(--background-danger-button-primary)';
      syncBtn.disabled = false;
      syncBtn.textContent = getTranslation('admin.console.sync.names_button', 'Nevek szinkronizálása');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    statusDiv.textContent = `${usersSnap.docs.length} felhasználó feldolgozása...`;

    // Process each user
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};
      const displayName = userData.displayName || '';

      if (!displayName) {
        console.warn(`[AdminConsole] User ${userId} has no displayName, skipping`);
        errorCount++;
        errors.push(`${userId}: nincs displayName`);
        continue;
      }

      try {
        // Create/update document in public/users/nevek/{userId}
        const publicUserRef = doc(db, 'public/users/nevek', userId);
        await setDoc(publicUserRef, {
          name: displayName
        }, { merge: true });

        successCount++;
        const processedText = getTranslation('admin.console.sync.processed', 'Feldolgozva:');
        statusDiv.textContent = `${processedText} ${successCount}/${usersSnap.docs.length}...`;
      } catch (err) {
        console.error(`[AdminConsole] Failed to sync user ${userId}:`, err);
        errorCount++;
        errors.push(`${userId}: ${err.message}`);
      }
    }

    // Show results
    // Töröljük az előző timeout-ot, ha van
    if (confirmationTimeouts.has('names')) {
      clearTimeout(confirmationTimeouts.get('names'));
    }

    if (errorCount === 0) {
      const successText = getTranslation('admin.console.sync.success_names', 'Sikeres! felhasználó neve szinkronizálva.');
      statusDiv.textContent = successText.replace('{count}', successCount);
      statusDiv.style.color = 'var(--background-positive-button-primary)';

      // 5 másodperc után eltüntetjük
      const timeout = setTimeout(() => {
        statusDiv.textContent = '';
        confirmationTimeouts.delete('names');
      }, 5000);
      confirmationTimeouts.set('names', timeout);
    } else {
      const doneText = getTranslation('admin.console.sync.done', 'Kész! sikeres, hiba.');
      statusDiv.textContent = doneText.replace('{success}', successCount).replace('{error}', errorCount);
      statusDiv.style.color = 'var(--background-danger-button-primary)';
      console.warn('[AdminConsole] Errors:', errors);
    }

    syncBtn.disabled = false;
    syncBtn.textContent = getTranslation('admin.console.sync.names_button', 'Nevek szinkronizálása');
  } catch (error) {
    console.error('[AdminConsole] Sync failed:', error);
    const errorText = getTranslation('admin.console.sync.error', 'Hiba:');
    statusDiv.textContent = `${errorText} ${error.message}`;
    statusDiv.style.color = 'var(--background-danger-button-primary)';
    syncBtn.disabled = false;
    syncBtn.textContent = getTranslation('admin.console.sync.names_button', 'Nevek szinkronizálása');
  }
}

async function syncUserPictures() {
  const syncBtn = document.getElementById('adminSyncPicturesBtn');
  const statusDiv = document.getElementById('adminSyncPicturesStatus');

  if (!syncBtn || !statusDiv) return;

  syncBtn.disabled = true;
  syncBtn.textContent = getTranslation('admin.console.sync.syncing', 'Szinkronizálás...');
  statusDiv.textContent = getTranslation('admin.console.sync.loading_users', 'Felhasználók betöltése...');
  statusDiv.style.color = 'var(--text-default-teritary)';

  try {
    const db = window.db;

    if (!db) {
      throw new Error('Firestore database not available. Please refresh the page.');
    }

    const { collection, getDocs, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

    // Read all user documents from users collection
    const usersRef = collection(db, 'users');
    const usersSnap = await getDocs(usersRef);

    if (usersSnap.empty) {
      statusDiv.textContent = getTranslation('admin.console.sync.no_users', 'Nincs felhasználó a users kollekcióban.');
      statusDiv.style.color = 'var(--background-danger-button-primary)';
      syncBtn.disabled = false;
      syncBtn.textContent = getTranslation('admin.console.sync.pictures_button', 'Képek szinkronizálása');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    statusDiv.textContent = `${usersSnap.docs.length} felhasználó feldolgozása...`;

    // Process each user
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};

      try {
        // Create/update document in public/users/profilePictures/{userId}
        const profilePictureData = {};
        if (userData.useProvidedPfp !== undefined) {
          profilePictureData.useProvidedPfp = userData.useProvidedPfp;
        }
        if (userData.pfpColor) {
          profilePictureData.pfpColor = userData.pfpColor;
        }
        if (userData.profilePictureUrl) {
          profilePictureData.profilePictureUrl = userData.profilePictureUrl;
        }

        if (Object.keys(profilePictureData).length > 0) {
          const profilePictureRef = doc(db, 'public/users/profilePictures', userId);
          await setDoc(profilePictureRef, profilePictureData, { merge: true });
          successCount++;
        } else {
          // No picture data to sync, but not an error
          successCount++;
        }

        const processedText = getTranslation('admin.console.sync.processed', 'Feldolgozva:');
        statusDiv.textContent = `${processedText} ${successCount}/${usersSnap.docs.length}...`;
      } catch (err) {
        console.error(`[AdminConsole] Failed to sync user ${userId}:`, err);
        errorCount++;
        errors.push(`${userId}: ${err.message}`);
      }
    }

    // Show results
    // Töröljük az előző timeout-ot, ha van
    if (confirmationTimeouts.has('pictures')) {
      clearTimeout(confirmationTimeouts.get('pictures'));
    }

    if (errorCount === 0) {
      const successText = getTranslation('admin.console.sync.success_pictures', 'Sikeres! felhasználó képe szinkronizálva.');
      statusDiv.textContent = successText.replace('{count}', successCount);
      statusDiv.style.color = 'var(--background-positive-button-primary)';

      // 5 másodperc után eltüntetjük
      const timeout = setTimeout(() => {
        statusDiv.textContent = '';
        confirmationTimeouts.delete('pictures');
      }, 5000);
      confirmationTimeouts.set('pictures', timeout);
    } else {
      const doneText = getTranslation('admin.console.sync.done', 'Kész! sikeres, hiba.');
      statusDiv.textContent = doneText.replace('{success}', successCount).replace('{error}', errorCount);
      statusDiv.style.color = 'var(--background-danger-button-primary)';
      console.warn('[AdminConsole] Errors:', errors);
    }

    syncBtn.disabled = false;
    syncBtn.textContent = getTranslation('admin.console.sync.pictures_button', 'Képek szinkronizálása');
  } catch (error) {
    console.error('[AdminConsole] Sync failed:', error);
    const errorText = getTranslation('admin.console.sync.error', 'Hiba:');
    statusDiv.textContent = `${errorText} ${error.message}`;
    statusDiv.style.color = 'var(--background-danger-button-primary)';
    syncBtn.disabled = false;
    syncBtn.textContent = getTranslation('admin.console.sync.pictures_button', 'Képek szinkronizálása');
  }
}

function showAdminConsole() {
  const consoleDiv = document.getElementById('adminConsole');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (consoleDiv && scrollArea) {
    scrollArea.scrollTop = 0;
    scrollArea.classList.add('no-scroll');
    scrollArea.classList.add('popup-active');
    consoleDiv.style.display = 'flex';
  }
}

function hideAdminConsole() {
  const consoleDiv = document.getElementById('adminConsole');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (consoleDiv) {
    consoleDiv.style.display = 'none';
  }
  if (scrollArea) {
    scrollArea.classList.remove('no-scroll');
    scrollArea.classList.remove('popup-active');
  }
  // Töröljük a session check-et is
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
  }
}

function toggleAdminInfo() {
  const infoBtn = document.getElementById('adminInfoBtn');
  const infoText = document.getElementById('adminInfoText');
  if (!infoBtn || !infoText) return;

  const isVisible = infoText.style.display !== 'none';
  infoText.style.display = isVisible ? 'none' : 'block';
  const span = infoBtn.querySelector('span');
  if (span) {
    const showText = getTranslation('admin.console.sync.info_show', 'Információk megjelenítése');
    const hideText = getTranslation('admin.console.sync.info_hide', 'Információk elrejtése');
    span.textContent = isVisible ? showText : hideText;
  }
}

function initAdminConsole() {
  // Find main-scroll-area to append popups
  const mainScrollArea = document.querySelector('.main-scroll-area');
  if (!mainScrollArea) {
    console.error('[AdminConsole] main-scroll-area not found');
    return;
  }

  // Create popup HTML
  if (!document.getElementById('adminConsolePopup')) {
    const popup = document.createElement('div');
    popup.id = 'adminConsolePopup';
    popup.className = 'permission-overlay-scroll-area';
    popup.style.display = 'none';
    popup.innerHTML = `
      <div class="permission-container">
        <button class="permission-close-btn" onclick="closeAdminConsolePopup()">
          <img src="assets/general/close.svg" alt="Bezárás">
        </button>
        <div class="permission-content">
          <h2 class="permission-title" data-translate="admin.console.title" data-translate-fallback="Admin Konzol">Admin Konzol</h2>
          <p class="permission-text" data-translate="admin.console.password_text" data-translate-fallback="Jelszó megadása:">Jelszó megadása:</p>
          <input type="password" id="adminConsolePassword" class="dev-mode-input" data-translate-placeholder="admin.console.password_placeholder" placeholder="Jelszó">
          <button class="permission-ok-btn" onclick="checkAdminConsolePassword()" data-translate="admin.console.login_button" data-translate-fallback="Bejelentkezés">Bejelentkezés</button>
        </div>
      </div>
    `;
    mainScrollArea.appendChild(popup);
    // Apply translations to popup
    if (window.translationManager) {
      window.translationManager.applyTranslationsToElement(popup);
    }
  }

  // Create password popup (for first time users)
  if (!document.getElementById('createPasswordPopup')) {
    const createPwdPopup = document.createElement('div');
    createPwdPopup.id = 'createPasswordPopup';
    createPwdPopup.className = 'permission-overlay-scroll-area';
    createPwdPopup.style.display = 'none';
    createPwdPopup.innerHTML = `
      <div class="permission-container">
        <button class="permission-close-btn" onclick="closeCreatePasswordPopup()">
          <img src="assets/general/close.svg" alt="Bezárás">
        </button>
        <div class="permission-content">
          <h2 class="permission-title" data-translate="admin.console.create_password.title" data-translate-fallback="Hozz létre egy jelszót">Hozz létre egy jelszót</h2>
          <p class="permission-text" data-translate="admin.console.create_password.text" data-translate-fallback="Hozd létre a jelszavad a munkameneted elindításához. A jelszó nem lehet rövidebb 8 karakternél, és olyan jelszót adj meg amit máshol nem használsz még.">Hozd létre a jelszavad a munkameneted elindításához. A jelszó nem lehet rövidebb 8 karakternél, és olyan jelszót adj meg amit máshol nem használsz még.</p>
          <input type="password" id="createPasswordInput" class="dev-mode-input" data-translate-placeholder="admin.console.create_password.placeholder" placeholder="Jelszó (min. 8 karakter)">
          <button class="permission-ok-btn" onclick="submitCreatePassword()" data-translate="admin.console.create_password.submit" data-translate-fallback="Jelszó létrehozása">Jelszó létrehozása</button>
        </div>
      </div>
    `;
    mainScrollArea.appendChild(createPwdPopup);
    // Apply translations to create password popup
    if (window.translationManager) {
      window.translationManager.applyTranslationsToElement(createPwdPopup);
    }
  }

  // Create admin console HTML
  if (!document.getElementById('adminConsole')) {
    const consoleDiv = document.createElement('div');
    consoleDiv.id = 'adminConsole';
    consoleDiv.className = 'permission-overlay-scroll-area';
    consoleDiv.style.display = 'none';
    consoleDiv.innerHTML = `
      <div class="permission-container" style="max-width: 600px;">
        <button class="permission-close-btn" onclick="hideAdminConsole()">
          <img src="assets/general/close.svg" alt="Bezárás">
        </button>
        <div class="permission-content">
          <h2 class="permission-title" data-translate="admin.console.title" data-translate-fallback="Admin Konzol">Admin Konzol</h2>
          <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 20px;">
            <div>
              <h3 style="color: var(--text-default-teritary); font-size: 18px; margin-bottom: 8px;" data-translate="admin.console.sync.users_title" data-translate-fallback="Felhasználók szinkronizálása">Felhasználók szinkronizálása</h3>
              <p style="color: #E5FDCB; font-size: 14px; margin-bottom: 12px;" data-translate="admin.console.sync.users_description" data-translate-fallback="Beolvassa az összes felhasználót a users kollekcióból, és létrehozza/frissíti a megfelelő dokumentumokat.">
                Beolvassa az összes felhasználót a <code>users</code> kollekcióból, és létrehozza/frissíti a megfelelő dokumentumokat.
              </p>
              <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                <div style="flex: 1;">
                  <button id="adminSyncNamesBtn" class="permission-ok-btn" onclick="syncUserNames()" style="width: 100%;" data-translate="admin.console.sync.names_button" data-translate-fallback="Nevek szinkronizálása">
                    Nevek szinkronizálása
                  </button>
                  <div id="adminSyncNamesStatus" style="margin-top: 8px; color: var(--text-default-teritary); font-size: 12px; min-height: 16px;"></div>
                </div>
                <div style="flex: 1;">
                  <button id="adminSyncPicturesBtn" class="permission-ok-btn" onclick="syncUserPictures()" style="width: 100%;" data-translate="admin.console.sync.pictures_button" data-translate-fallback="Képek szinkronizálása">
                    Képek szinkronizálása
                  </button>
                  <div id="adminSyncPicturesStatus" style="margin-top: 8px; color: var(--text-default-teritary); font-size: 12px; min-height: 16px;"></div>
                </div>
              </div>
              <button id="adminInfoBtn" class="suggestions-cta-sml" onclick="toggleAdminInfo()" style="background: #C5EE96; border-color: var(--border-default-secondary); color: var(--text-button-secondary); width: 100%; margin-top: 8px;">
                <span data-translate="admin.console.sync.info_show" data-translate-fallback="Információk megjelenítése">Információk megjelenítése</span>
              </button>
              <div id="adminInfoText" style="display: none; color: #E5FDCB; font-size: 12px; margin-top: 12px;" data-translate="admin.console.sync.info_text" data-translate-fallback="Nevek: public/users/nevek/{userId} - A name mező a displayName értékét tartalmazza\n\nKépek: public/users/profilePictures/{userId} - A useProvidedPfp, pfpColor, és profilePictureUrl mezőket tartalmazza">
                <strong>Nevek:</strong> <code>public/users/nevek/{userId}</code> - A <code>name</code> mező a <code>displayName</code> értékét tartalmazza<br>
                <strong>Képek:</strong> <code>public/users/profilePictures/{userId}</code> - A <code>useProvidedPfp</code>, <code>pfpColor</code>, és <code>profilePictureUrl</code> mezőket tartalmazza
              </div>
            </div>
            <div>
              <h3 style="color: var(--text-default-teritary); font-size: 18px; margin-bottom: 8px;" data-translate="admin.console.assign_class.title" data-translate-fallback="Osztályhoz rendelés">Osztályhoz rendelés</h3>
              <p style="color: #E5FDCB; font-size: 14px; margin-bottom: 12px;" data-translate="admin.console.assign_class.description" data-translate-fallback="Felhasználókat rendelhet hozzá osztályokhoz a classes/{classId}/users kollekcióban.">
                Felhasználókat rendelhet hozzá osztályokhoz a <code>classes/{classId}/users</code> kollekcióban.
              </p>
              <button id="adminAssignClassBtn" class="permission-ok-btn" onclick="showAssignClassPopup()" style="width: 100%;" data-translate="admin.console.assign_class.button" data-translate-fallback="Osztályhoz rendelés">
                Osztályhoz rendelés
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    mainScrollArea.appendChild(consoleDiv);
    // Apply translations to console
    if (window.translationManager) {
      window.translationManager.applyTranslationsToElement(consoleDiv);
    }
  }

  // Create assign class popup 1 (class selection)
  if (!document.getElementById('adminAssignClassPopup1')) {
    const popup1 = document.createElement('div');
    popup1.id = 'adminAssignClassPopup1';
    popup1.className = 'permission-overlay-scroll-area';
    popup1.style.display = 'none';
    popup1.innerHTML = `
      <div class="permission-container" style="max-width: 500px;">
        <button class="permission-close-btn" onclick="closeAssignClassPopup1()">
          <img src="assets/general/close.svg" alt="Bezárás">
        </button>
        <div class="permission-content">
          <h2 class="permission-title" data-translate="admin.console.assign_class.popup1.title" data-translate-fallback="Osztály kiválasztása">Osztály kiválasztása</h2>
          <p class="permission-text" style="margin-bottom: 16px;" data-translate="admin.console.assign_class.popup1.text" data-translate-fallback="Írd be a csoport nevét:">Írd be a csoport nevét:</p>
          <div style="position: relative; margin-bottom: 16px;">
            <input type="text" id="adminClassSearchInput" class="dev-mode-input" data-translate-placeholder="admin.console.assign_class.popup1.placeholder" placeholder="Ide írj...">
            <div id="adminClassGhost" class="ghost-text" data-ghost-for="class"></div>
          </div>
          <div class="suggestions-checkbox" style="margin-bottom: 20px;">
            <button class="suggestions-checkbox-toggle" type="button" id="adminCreateGradesToggle" aria-pressed="false">
              <img src="assets/youhub/suggestions/check_dark.svg" alt="" aria-hidden="true">
            </button>
            <div class="suggestions-checkbox-text">
              <span class="suggestions-checkbox-title" data-translate="admin.console.assign_class.popup1.checkbox_title" data-translate-fallback="Értékek létrehozása">Értékek létrehozása</span>
              <p class="suggestions-checkbox-desc" data-translate="admin.console.assign_class.popup1.checkbox_description" data-translate-fallback="Ha be van jelölve, a grades doksikat value-kkal tölti fel (0.00-5.00).">Ha be van jelölve, a grades doksikat value-kkal tölti fel (0.00-5.00).</p>
            </div>
          </div>
          <button class="permission-ok-btn" onclick="proceedToUserSelection()" style="margin-top: 20px; width: 100%;" data-translate="admin.console.assign_class.popup1.next" data-translate-fallback="Tovább">
            Tovább
          </button>
        </div>
      </div>
    `;
    mainScrollArea.appendChild(popup1);
    // Apply translations to popup1
    if (window.translationManager) {
      window.translationManager.applyTranslationsToElement(popup1);
    }
  }

  // Create assign class popup 2 (user selection)
  if (!document.getElementById('adminAssignClassPopup2')) {
    const popup2 = document.createElement('div');
    popup2.id = 'adminAssignClassPopup2';
    popup2.className = 'permission-overlay-scroll-area';
    popup2.style.display = 'none';
    popup2.innerHTML = `
      <div class="permission-container" style="max-width: 600px;">
        <div class="permission-content">
          <h2 class="permission-title" data-translate="admin.console.assign_class.popup2.title" data-translate-fallback="Felhasználók kiválasztása">Felhasználók kiválasztása</h2>
          <p class="permission-text" style="margin-bottom: 16px;" data-translate="admin.console.assign_class.popup2.text" data-translate-fallback="Írd be a felhasználók nevét, vagy kattints az automatizálásra:">Írd be a felhasználók nevét, vagy kattints az automatizálásra:</p>
          <div style="position: relative; margin-bottom: 20px;">
            <input type="text" id="adminUserSearchInput" class="dev-mode-input" data-translate-placeholder="admin.console.assign_class.popup2.placeholder" placeholder="Ide írj...">
            <div id="adminUserGhost" class="ghost-text" data-ghost-for="user"></div>
          </div>
          <div style="display: flex; gap: 12px; align-items: stretch;">
            <button class="suggestions-cta-sml suggestions-cta--secondary" onclick="goBackToClassSelection()" style="flex: 0 0 auto;">
              <img src="assets/youhub/suggestions/next.svg" alt="" aria-hidden="true" class="suggestions-cta-icon--back">
            </button>
            <button class="permission-ok-btn" onclick="finishAssignClass()" style="flex: 1; width: auto;" data-translate="admin.console.assign_class.popup2.finish" data-translate-fallback="Befejezés">
              Befejezés
            </button>
            <button class="permission-ok-btn" onclick="autoAssignUsers()" style="flex: 0 0 auto; width: auto;" data-translate="admin.console.assign_class.popup2.auto" data-translate-fallback="Auto">
              Auto
            </button>
          </div>
        </div>
      </div>
    `;
    mainScrollArea.appendChild(popup2);
    // Apply translations to popup2
    if (window.translationManager) {
      window.translationManager.applyTranslationsToElement(popup2);
    }
  }

  // Initialize assign class functionality
  initAssignClassFunctionality();

  // Make functions globally available
  window.showAdminConsolePopup = showAdminConsolePopup;
  window.closeAdminConsolePopup = closeAdminConsolePopup;
  window.checkAdminConsolePassword = checkAdminConsolePassword;
  window.syncUserNames = syncUserNames;
  window.syncUserPictures = syncUserPictures;
  window.hideAdminConsole = hideAdminConsole;
  window.showAdminConsole = showAdminConsole;
  window.toggleAdminInfo = toggleAdminInfo;
  window.showAssignClassPopup = showAssignClassPopup;
  window.closeAssignClassPopup1 = closeAssignClassPopup1;
  window.proceedToUserSelection = proceedToUserSelection;
  window.goBackToClassSelection = goBackToClassSelection;
  window.autoAssignUsers = autoAssignUsers;
  window.finishAssignClass = finishAssignClass;
  window.showCreatePasswordPopup = showCreatePasswordPopup;
  window.closeCreatePasswordPopup = closeCreatePasswordPopup;
  window.submitCreatePassword = submitCreatePassword;

  // Check if already enabled and has valid session - but don't auto-open
  // User must press Ctrl+Shift+A to open the console
  // Session check will happen when they try to open it

  // Add keyboard shortcut (Ctrl+Shift+A or Cmd+Shift+A)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      if (isAdminConsoleEnabled()) {
        showAdminConsole();
      } else {
        showAdminConsolePopup();
      }
    }
  });

  // Enter key in password input
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('adminConsolePopup')?.style.display === 'flex') {
      checkAdminConsolePassword();
    }
  });

  console.log('[AdminConsole] Initialized. Press Ctrl+Shift+A (or Cmd+Shift+A) to open.');
}

// Assign class functionality
let selectedClassId = null;
let selectedUserIds = [];
let classSuggestions = [];
// userSuggestions is already declared at the top of the file

function initAssignClassFunctionality() {
  // This will be called after DOM is ready
  setTimeout(() => {
    const classInput = document.getElementById('adminClassSearchInput');
    const userInput = document.getElementById('adminUserSearchInput');
    const classGhost = document.getElementById('adminClassGhost');
    const userGhost = document.getElementById('adminUserGhost');
    const gradesToggle = document.getElementById('adminCreateGradesToggle');

    // Initialize checkbox toggle
    if (gradesToggle) {
      gradesToggle.addEventListener('click', () => {
        const isChecked = gradesToggle.classList.contains('is-checked');
        gradesToggle.classList.toggle('is-checked', !isChecked);
        gradesToggle.setAttribute('aria-pressed', !isChecked ? 'true' : 'false');
        const img = gradesToggle.querySelector('img');
        if (img) {
          img.style.opacity = !isChecked ? '1' : '0';
        }
      });
    }

    if (classInput && classGhost) {
      loadClassSuggestions().catch(err => console.warn('[AdminConsole] Failed to load class suggestions on init:', err));
      classInput.addEventListener('input', () => updateClassGhost());
      classInput.addEventListener('focus', () => {
        loadClassSuggestions().catch(err => console.warn('[AdminConsole] Failed to load class suggestions on focus:', err));
        updateClassGhost();
      });
      classInput.addEventListener('blur', () => {
        if (classGhost) classGhost.textContent = '';
      });
      classInput.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && !event.shiftKey) {
          const value = classInput.value.trim().toLowerCase();
          const suggestion = findClassSuggestion(value);
          if (suggestion) {
            event.preventDefault();
            classInput.value = suggestion.display;
            selectedClassId = suggestion.id;
            updateClassGhost();
          }
        }
      });
    }

    if (userInput && userGhost) {
      loadUserSuggestions().catch(err => console.warn('[AdminConsole] Failed to load user suggestions on init:', err));
      let lastCommaSpaceDeleted = false;
      userInput.addEventListener('input', () => {
        updateUserGhost();
        lastCommaSpaceDeleted = false;
      });
      userInput.addEventListener('focus', () => {
        loadUserSuggestions().catch(err => console.warn('[AdminConsole] Failed to load user suggestions on focus:', err));
        updateUserGhost();
        lastCommaSpaceDeleted = false;
      });
      userInput.addEventListener('blur', () => {
        if (userGhost) userGhost.textContent = '';
      });
      userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && !event.shiftKey) {
          const fullValue = userInput.value;
          const lastCommaIndex = fullValue.lastIndexOf(',');
          const searchValue = lastCommaIndex >= 0 ? fullValue.slice(lastCommaIndex + 1).trim() : fullValue.trim();
          const suggestion = findUserSuggestionForAssign(searchValue);
          if (suggestion && suggestion.display) {
            event.preventDefault();
            const newName = suggestion.display;
            if (lastCommaIndex >= 0) {
              const beforeComma = fullValue.slice(0, lastCommaIndex + 1).trim();
              userInput.value = `${beforeComma} ${newName}`;
            } else {
              userInput.value = newName;
            }
            updateUserGhost();
            lastCommaSpaceDeleted = false;
          }
        } else if (event.key === ' ' && !lastCommaSpaceDeleted) {
          const fullValue = userInput.value;
          const lastCommaIndex = fullValue.lastIndexOf(',');
          const searchValue = lastCommaIndex >= 0 ? fullValue.slice(lastCommaIndex + 1).trim() : fullValue.trim();
          const suggestion = findUserSuggestionForAssign(searchValue);
          if (suggestion && suggestion.display && suggestion.display.toLowerCase() === searchValue.toLowerCase()) {
            event.preventDefault();
            const beforeComma = lastCommaIndex >= 0 ? fullValue.slice(0, lastCommaIndex + 1).trim() : '';
            userInput.value = beforeComma ? `${beforeComma} ${suggestion.display}, ` : `${suggestion.display}, `;
            updateUserGhost();
          }
        } else if (event.key === 'Backspace') {
          const fullValue = userInput.value;
          const cursorPos = userInput.selectionStart || 0;
          if (cursorPos > 0 && fullValue.slice(cursorPos - 2, cursorPos) === ', ') {
            lastCommaSpaceDeleted = true;
          }
        }
      });
    }
  }, 100);
}

async function loadClassSuggestions() {
  try {
    const db = window.db;
    if (!db) return;
    const { collection, getDocs, query, limit } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
    const classesSnap = await getDocs(query(collection(db, 'classes'), limit(50)));
    classSuggestions = classesSnap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      const classType = (data.classType || '').toLowerCase();
      const classFinishes = data.classFinishes || new Date().getFullYear() + 4;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      let grade = classFinishes - currentYear;
      if (currentMonth >= 1 && currentMonth <= 8) {
        grade -= 1;
      }
      if (grade < 1) grade = 1;
      if (grade > 12) grade = 12;
      const classId = `${classFinishes}${classType}`;
      let classLabel = getTranslation('youhub.myclass.title', 'Osztályom');
      if (classLabel === 'Osztályom') classLabel = 'Osztály';
      else if (classLabel === 'My Class') classLabel = 'Class';
      else if (!classLabel) classLabel = 'Osztály';
      const display = `${grade}.${classType.toUpperCase()} ${classLabel}`;
      return {
        id: classId,
        display,
        match: display.toLowerCase()
      };
    });
  } catch (err) {
    console.warn('[AdminConsole] Failed to load class suggestions', err);
    classSuggestions = [];
  }
}

async function loadUserSuggestions() {
  try {
    const db = window.db;
    if (!db) return;
    const { collection, getDocs, query, limit } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
    const usersSnap = await getDocs(query(collection(db, 'public/users/nevek'), limit(100)));
    userSuggestions = usersSnap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      const displayName = data.name || data.displayName || docSnap.id;
      return {
        id: docSnap.id,
        display: displayName,
        match: displayName.toLowerCase()
      };
    });
  } catch (err) {
    console.warn('[AdminConsole] Failed to load user suggestions', err);
    userSuggestions = [];
  }
}

function findClassSuggestion(value) {
  if (!value) return null;
  const lowerValue = value.toLowerCase();
  return classSuggestions.find(item => item.match.startsWith(lowerValue)) || null;
}

function findUserSuggestionForAssign(value) {
  if (!value) return null;
  const lowerValue = value.toLowerCase();
  const fullValue = document.getElementById('adminUserSearchInput')?.value || '';
  const lastCommaIndex = fullValue.lastIndexOf(',');
  const beforeLastComma = lastCommaIndex >= 0 ? fullValue.slice(0, lastCommaIndex) : '';
  const usedNames = beforeLastComma ? beforeLastComma.split(',').map(s => s.trim().toLowerCase()).filter(s => s) : [];
  const available = userSuggestions.filter(item => {
    const matchLower = item.match.toLowerCase();
    return !usedNames.some(used => matchLower === used);
  });
  return available.find(item => item.match.startsWith(lowerValue)) || null;
}

function updateClassGhost() {
  const input = document.getElementById('adminClassSearchInput');
  const ghost = document.getElementById('adminClassGhost');
  if (!input || !ghost) return;
  const value = input.value.trim().toLowerCase();
  const suggestion = findClassSuggestion(value);
  if (value && suggestion && suggestion.display.toLowerCase().startsWith(value)) {
    const prefix = suggestion.display.slice(0, value.length);
    const remainder = suggestion.display.slice(value.length);
    ghost.innerHTML = `<span class="ghost-prefix">${escapeHtml(prefix)}</span>${escapeHtml(remainder)}`;
    ghost.classList.add('is-visible');
  } else {
    ghost.textContent = '';
    ghost.classList.remove('is-visible');
  }
}

function updateUserGhost() {
  const input = document.getElementById('adminUserSearchInput');
  const ghost = document.getElementById('adminUserGhost');
  if (!input || !ghost) return;
  const fullValue = input.value;
  const lastCommaIndex = fullValue.lastIndexOf(',');
  const searchValue = lastCommaIndex >= 0 ? fullValue.slice(lastCommaIndex + 1).trim() : fullValue.trim();
  const suggestion = findUserSuggestionForAssign(searchValue);
  if (searchValue && suggestion && suggestion.display.toLowerCase().startsWith(searchValue.toLowerCase())) {
    const prefix = suggestion.display.slice(0, searchValue.length);
    const remainder = suggestion.display.slice(searchValue.length);
    ghost.innerHTML = `<span class="ghost-prefix">${escapeHtml(prefix)}</span>${escapeHtml(remainder)}`;
    ghost.classList.add('is-visible');
  } else {
    ghost.textContent = '';
    ghost.classList.remove('is-visible');
  }
}

function escapeHtml(value) {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showAssignClassPopup() {
  const popup = document.getElementById('adminAssignClassPopup1');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup && scrollArea) {
    scrollArea.scrollTop = 0;
    scrollArea.classList.add('no-scroll');
    scrollArea.classList.add('popup-active');
    popup.style.display = 'flex';
    selectedClassId = null;
    const input = document.getElementById('adminClassSearchInput');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
  }
}

function closeAssignClassPopup1() {
  const popup = document.getElementById('adminAssignClassPopup1');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup) {
    popup.style.display = 'none';
  }
  if (scrollArea) {
    scrollArea.classList.remove('no-scroll');
    scrollArea.classList.remove('popup-active');
  }
}

async function proceedToUserSelection() {
  const input = document.getElementById('adminClassSearchInput');
  if (!input) return;
  const value = input.value.trim();
  if (!value) {
    const msg = getTranslation('admin.console.messages.class_name_required', 'Kérlek add meg az osztály nevét!');
    const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
    await showNotification(msg, title, 'warning');
    return;
  }

  // Try to find the class ID
  const suggestion = findClassSuggestion(value.toLowerCase());
  if (suggestion) {
    selectedClassId = suggestion.id;
  } else {
    // Try to parse directly (e.g., "8e" or "2030e")
    const match = value.match(/^(\d+)([a-zA-Z])$/i);
    if (match) {
      const year = match[1];
      const letter = match[2].toLowerCase();
      selectedClassId = `${year}${letter}`;
    } else {
      const msg = getTranslation('admin.console.messages.class_not_found', 'Nem található osztály ezzel a névvel!');
      const title = getTranslation('admin.console.status.wrong_data', 'Hibás adatok');
      await showNotification(msg, title, 'danger');
      return;
    }
  }

  // Close popup 1 and open popup 2
  closeAssignClassPopup1();
  const popup2 = document.getElementById('adminAssignClassPopup2');
  const scrollArea = document.querySelector('.main-scroll-area');
  if (popup2 && scrollArea) {
    scrollArea.scrollTop = 0;
    scrollArea.classList.add('no-scroll');
    scrollArea.classList.add('popup-active');
    popup2.style.display = 'flex';
    const userInput = document.getElementById('adminUserSearchInput');
    if (userInput) {
      userInput.value = '';
      setTimeout(() => userInput.focus(), 100);
    }
  }
}

function goBackToClassSelection() {
  const popup2 = document.getElementById('adminAssignClassPopup2');
  if (popup2) {
    popup2.style.display = 'none';
  }
  // showAssignClassPopup already handles scroll area
  showAssignClassPopup();
}

async function autoAssignUsers() {
  if (!selectedClassId) {
    const msg = getTranslation('admin.console.messages.no_class_selected', 'Nincs kiválasztott osztály!');
    const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
    await showNotification(msg, title, 'warning');
    return;
  }

  try {
    const db = window.db;
    if (!db) {
      throw new Error('Firestore database not available');
    }
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
    const { collection, getDocs, doc, getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
    const auth = getAuth();
    if (!auth.currentUser) {
      const msg = getTranslation('admin.console.messages.login_required', 'Be kell jelentkezned!');
      const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
      await showNotification(msg, title, 'warning');
      return;
    }

    // Get all users
    const usersRef = collection(db, 'users');
    const usersSnap = await getDocs(usersRef);
    const userIds = [];

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        // Check users/{userId}/groups/ownclass/ - lehet hogy subcollection vagy document
        // Először próbáljuk document-ként
        const ownClassRef = doc(db, `users/${userId}/groups/ownclass`);
        const ownClassSnap = await getDoc(ownClassRef);

        let ownClassData = null;
        if (ownClassSnap.exists()) {
          ownClassData = ownClassSnap.data() || {};
        } else {
          // Ha nem létezik document-ként, próbáljuk subcollection-ként
          try {
            const ownClassCollectionRef = collection(db, `users/${userId}/groups/ownclass`);
            const ownClassCollectionSnap = await getDocs(ownClassCollectionRef);
            if (!ownClassCollectionSnap.empty) {
              // Ha van subcollection, vegyük az első dokumentumot
              ownClassData = ownClassCollectionSnap.docs[0].data() || {};
            }
          } catch (collectionErr) {
            // Nincs subcollection sem, folytassuk a következő felhasználóval
            continue;
          }
        }

        if (ownClassData) {
          const classFinishes = ownClassData.classFinishes;
          const classType = (ownClassData.classType || '').toLowerCase();

          if (classFinishes && classType) {
            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth() + 1;
            let grade = classFinishes - currentYear;
            if (currentMonth >= 1 && currentMonth <= 8) {
              grade -= 1;
            }
            if (grade < 1) grade = 1;
            if (grade > 12) grade = 12;

            const calculatedClassId = `${classFinishes}${classType}`;
            if (calculatedClassId === selectedClassId) {
              userIds.push(userId);
            }
          }
        }
      } catch (err) {
        // Csak akkor logoljuk, ha valódi hiba van, nem csak ha nincs dokumentum
        if (err.code !== 'not-found' && err.code !== 'permission-denied') {
          console.warn(`[AdminConsole] Failed to check user ${userId}:`, err.message);
        }
      }
    }

    selectedUserIds = userIds;

    // Update the input field with user names
    const userInput = document.getElementById('adminUserSearchInput');
    if (userInput) {
      const userNames = [];
      for (const userId of userIds) {
        try {
          const nameRef = doc(db, `public/users/nevek/${userId}`);
          const nameSnap = await getDoc(nameRef);
          if (nameSnap.exists()) {
            const nameData = nameSnap.data() || {};
            const name = nameData.name || nameData.displayName;
            if (name) {
              userNames.push(name);
            }
          }
        } catch (err) {
          console.warn(`[AdminConsole] Failed to get name for ${userId}`, err);
        }
      }
      userInput.value = userNames.join(', ');
    }

    const msg = getTranslation('admin.console.messages.auto_success', 'Automatikusan felhasználó lett kiválasztva.').replace('{count}', userIds.length);
    const title = getTranslation('admin.console.status.success', 'Sikeres művelet');
    await showNotification(msg, title, 'positive');
  } catch (error) {
    console.error('[AdminConsole] Auto assign failed', error);
    const msg = getTranslation('admin.console.messages.auto_error', 'Hiba történt az automatikus kiválasztás során.');
    const title = getTranslation('admin.console.status.error', 'Hiba');
    await showNotification(msg, title, 'danger');
  }
}

async function finishAssignClass() {
  if (!selectedClassId) {
    const msg = getTranslation('admin.console.messages.no_class_selected', 'Nincs kiválasztott osztály!');
    const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
    await showNotification(msg, title, 'warning');
    return;
  }

  try {
    const db = window.db;
    if (!db) {
      throw new Error('Firestore database not available');
    }
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
    const { collection, getDocs, doc, getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
    const auth = getAuth();
    if (!auth.currentUser) {
      const msg = getTranslation('admin.console.messages.login_required', 'Be kell jelentkezned!');
      const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
      await showNotification(msg, title, 'warning');
      return;
    }

    // Get user IDs from input or from selectedUserIds
    let userIdsToAssign = selectedUserIds;
    if (userIdsToAssign.length === 0) {
      const userInput = document.getElementById('adminUserSearchInput');
      if (userInput && userInput.value.trim()) {
        const userNames = userInput.value.split(',').map(s => s.trim()).filter(s => s);
        userIdsToAssign = [];
        for (const userName of userNames) {
          const userSuggestion = userSuggestions.find(u => u.display.toLowerCase() === userName.toLowerCase());
          if (userSuggestion) {
            userIdsToAssign.push(userSuggestion.id);
          }
        }
      }
    }

    if (userIdsToAssign.length === 0) {
      const msg = getTranslation('admin.console.messages.no_users_selected', 'Nincs kiválasztott felhasználó!');
      const title = getTranslation('admin.console.status.missing_data', 'Hiányzó adatok');
      await showNotification(msg, title, 'warning');
      return;
    }

    // Check if class document exists, create if not
    const classRef = doc(db, `classes/${selectedClassId}`);
    const classSnap = await getDoc(classRef);

    // Check if grades should be created with values (read from checkbox state)
    const gradesToggle = document.getElementById('adminCreateGradesToggle');
    const createWithValues = gradesToggle && gradesToggle.classList.contains('is-checked');

    if (!classSnap.exists()) {
      // Create class document (empty for now, or with basic data if needed)
      await setDoc(classRef, {}, { merge: true });

      // Create grades subcollection with 01-12 documents
      for (let i = 1; i <= 12; i++) {
        const gradeId = String(i).padStart(2, '0'); // 01, 02, 03, ..., 12
        const gradeRef = doc(db, `classes/${selectedClassId}/grades/${gradeId}`);
        const gradeData = {};

        if (createWithValues) {
          // Generate random value between 0.00 and 5.00
          const value = Math.round((Math.random() * 5) * 100) / 100; // Round to 2 decimals
          gradeData.value = value;
        }

        await setDoc(gradeRef, gradeData, { merge: true });
      }
    } else {
      // Class exists, but check if grades need to be created/updated
      const gradesRef = collection(db, `classes/${selectedClassId}/grades`);
      const gradesSnap = await getDocs(gradesRef);

      // If no grades exist, create them
      if (gradesSnap.empty) {
        for (let i = 1; i <= 12; i++) {
          const gradeId = String(i).padStart(2, '0');
          const gradeRef = doc(db, `classes/${selectedClassId}/grades/${gradeId}`);
          const gradeData = {};

          if (createWithValues) {
            const value = Math.round((Math.random() * 5) * 100) / 100;
            gradeData.value = value;
          }

          await setDoc(gradeRef, gradeData, { merge: true });
        }
      } else if (createWithValues) {
        // Grades exist, but checkbox is checked - update with values if they don't have them
        for (const gradeDoc of gradesSnap.docs) {
          const gradeData = gradeDoc.data() || {};
          if (gradeData.value === undefined) {
            const value = Math.round((Math.random() * 5) * 100) / 100;
            await setDoc(gradeDoc.ref, { value }, { merge: true });
          }
        }
      }
    }

    // Get user names from users collection
    const usersRef = collection(db, 'users');
    const usersSnap = await getDocs(usersRef);
    const userNamesMap = new Map();
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data() || {};
      const displayName = userData.displayName || '';
      if (displayName) {
        userNamesMap.set(userDoc.id, displayName);
      }
    }

    // Create documents in classes/{classId}/users/{userId}
    let successCount = 0;
    let errorCount = 0;
    for (const userId of userIdsToAssign) {
      try {
        const userDocRef = doc(db, `classes/${selectedClassId}/users/${userId}`);
        const displayName = userNamesMap.get(userId) || 'Ismeretlen';
        await setDoc(userDocRef, {
          name: displayName
        }, { merge: true });
        successCount++;
      } catch (err) {
        console.error(`[AdminConsole] Failed to assign user ${userId}`, err);
        errorCount++;
      }
    }

    if (errorCount === 0) {
      const msg = getTranslation('admin.console.messages.assign_success', 'Sikeres! felhasználó lett hozzárendelve az osztályhoz.').replace('{count}', successCount);
      const title = getTranslation('admin.console.status.success', 'Sikeres művelet');
      await showNotification(msg, title, 'positive');
    } else {
      const msg = getTranslation('admin.console.messages.assign_done', 'Kész! sikeres, hiba.').replace('{success}', successCount).replace('{error}', errorCount);
      const title = getTranslation('admin.console.status.operation_complete', 'Művelet befejezve');
      await showNotification(msg, title, successCount > 0 ? 'positive' : 'danger');
    }

    // Close popup
    const popup2 = document.getElementById('adminAssignClassPopup2');
    const scrollArea = document.querySelector('.main-scroll-area');
    if (popup2) {
      popup2.style.display = 'none';
    }
    if (scrollArea) {
      scrollArea.classList.remove('no-scroll');
      scrollArea.classList.remove('popup-active');
    }
    selectedClassId = null;
    selectedUserIds = [];
  } catch (error) {
    console.error('[AdminConsole] Assign class failed', error);
    const msg = getTranslation('admin.console.messages.assign_error', 'Hiba történt az osztályhoz rendelés során.');
    const title = getTranslation('admin.console.status.error', 'Hiba');
    await showNotification(msg, title, 'danger');
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminConsole);
} else {
  initAdminConsole();
}


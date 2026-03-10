// Onboarding Handler - Teljes onboarding folyamat kezelése
// Ez a modul kezeli a bejelentkezési folyamatot, API adatok gyűjtését és Firestore mentést

import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { injectOnboardingPopup, checkBirthDateAndShowPopup } from './onboarding-popup.js';
import { isEmailAllowed } from '/EU2K-Hub/assets/js/allowed-emails.js';

// Globális változók az adatok tárolásához
let collectedData = {
  graphData: null,
  googleData: null,
  onboardingType: null,
  userInfo: null
};

// Popup injection inicializálása
document.addEventListener('DOMContentLoaded', () => {
  injectOnboardingPopup();
});

/**
 * Onboarding inicializálása - Auth state listener és API adatok gyűjtése
 * @param {Object} auth - Firebase Auth instance
 * @param {Object} db - Firestore database instance
 */
export function initializeOnboarding(auth, db) {
  console.log('🚀 Onboarding handler inicializálása...');

  // Onboarding típus meghatározása URL alapján
  const currentPath = window.location.pathname;
  if (currentPath.includes('onboarding_teacher.html')) {
    collectedData.onboardingType = 'teacher';
  } else if (currentPath.includes('onboarding_parent.html')) {
    collectedData.onboardingType = 'parent';
  } else {
    collectedData.onboardingType = 'student';
  }

  console.log('📋 Onboarding típus:', collectedData.onboardingType);

  // Auth state listener beállítása
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      console.log('👤 Felhasználó bejelentkezett:', user.uid);
      collectedData.userInfo = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      };

      // 0. Email whitelist ellenőrzés (Microsoft vagy Auth email alapján)
      try {
        const emailToCheck = user.email || (collectedData.graphData && collectedData.graphData.mail) || '';
        if (!emailToCheck) {
          console.warn('⚠️ Nincs elérhető email a whitelist ellenőrzéshez');
        }
        const allowed = await isEmailAllowed(emailToCheck);
        if (!allowed) {
          console.warn('⛔ Email nincs engedélyezve, restricted oldal megjelenítése:', emailToCheck);
          // Blokkoljuk a további onboarding scriptet
          window.location.hash = 'restricted';
          window.onboardingRestricted = true;
          if (typeof showPage === 'function') {
            try { showPage('restricted-page'); } catch (e) { }
          } else {
            const el = document.getElementById('restricted-page');
            if (el) {
              document.querySelectorAll('.welcome-page').forEach(p => p.classList.remove('active'));
              el.classList.add('active');
            }
          }
          return;
        }
      } catch (wlErr) {
        console.error('❌ Whitelist ellenőrzés hiba:', wlErr);
        window.location.hash = 'restricted';
        return;
      }

      // Ellenőrizzük, hogy a felhasználó már regisztrálva van-e Firebase-ben
      const existingUser = await checkExistingUser(user.uid, db);
      if (existingUser) {
        console.log('✅ Felhasználó már regisztrálva van, átirányítás index.html-re');
        // Beállítjuk a localStorage változókat
        localStorage.setItem('eu2k-auth-logged-in', 'true');
        localStorage.setItem('eu2k-auth-uid', user.uid);
        localStorage.setItem('eu2k-auth-display-name', user.displayName || '');
        localStorage.setItem('eu2k-auth-email', user.email || '');
        localStorage.setItem('onboardingCompleted', 'true');
        localStorage.setItem('termsAccepted', 'true');

        // Átirányítás az index.html-re
        window.location.href = '/EU2K-Hub/index.html';
        return;
      }

      // API adatok gyűjtése
      await collectAPIData();
    } else {
      console.log('❌ Nincs bejelentkezett felhasználó');
      collectedData = {
        graphData: null,
        googleData: null,
        onboardingType: collectedData.onboardingType,
        userInfo: null
      };
    }
  });

  // "Kezdjük" gomb event listener hozzáadása
  setupStartButton(auth, db);
}

/**
 * API adatok gyűjtése Microsoft Graph és Google API-ból
 */
async function collectAPIData() {
  console.log('📡 API adatok gyűjtése...');

  /**
   * Ellenőrzi, hogy a felhasználó már létezik-e a Firestore adatbázisban
   * @param {string} uid - Felhasználó azonosító
   * @param {Object} db - Firestore database instance
   * @returns {Promise<boolean>} - True ha a felhasználó már létezik
   */
  async function checkExistingUser(uid, db) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      return userDoc.exists;
    } catch (error) {
      console.error('❌ Hiba a felhasználó ellenőrzése során:', error);
      return false;
    }
  }

  // Microsoft Graph API adatok
  try {
    const graphToken = localStorage.getItem('eu2k-graph-token');
    if (graphToken) {
      console.log('🔍 Microsoft Graph API hívás...');
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${graphToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        collectedData.graphData = {
          displayName: data.displayName,
          mail: data.mail || data.userPrincipalName,
          jobTitle: data.jobTitle,
          department: data.department,
          officeLocation: data.officeLocation
        };
        console.log('✅ Microsoft Graph adatok:', collectedData.graphData);

        // Profilkép lekérése
        try {
          const photoResponse = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
            headers: {
              'Authorization': `Bearer ${graphToken}`
            }
          });

          if (photoResponse.ok) {
            const photoBlob = await photoResponse.blob();
            const photoUrl = URL.createObjectURL(photoBlob);
            collectedData.graphData.photoURL = photoUrl;
            localStorage.setItem('eu2k-profile-picture', photoUrl);
            console.log('✅ Microsoft Graph profilkép lekérve');
          } else {
            console.warn('⚠️ Microsoft Graph profilkép nem elérhető:', photoResponse.status);
          }
        } catch (photoError) {
          console.error('❌ Microsoft Graph profilkép hiba:', photoError);
        }

        // Mentés localStorage-ba is (kompatibilitás)
        localStorage.setItem('eu2k-graph-data', JSON.stringify(collectedData.graphData));
      } else {
        console.warn('⚠️ Microsoft Graph API hiba:', response.status);
      }
    }
  } catch (error) {
    console.error('❌ Microsoft Graph API hiba:', error);
  }

  // Google API adatok
  try {
    const googleToken = localStorage.getItem('eu2k-google-token');
    if (googleToken) {
      console.log('🔍 Google API hívás...');

      // Alapvető userinfo lekérése
      const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${googleToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (userinfoResponse.ok) {
        const userinfoData = await userinfoResponse.json();
        collectedData.googleData = {
          displayName: userinfoData.name,
          email: userinfoData.email,
          picture: userinfoData.picture,
          givenName: userinfoData.given_name,
          familyName: userinfoData.family_name,
          birthday: null // alapértelmezett
        };

        // Születési dátum lekérése People API-ból
        try {
          const peopleResponse = await fetch('https://people.googleapis.com/v1/people/me?personFields=birthdays', {
            headers: {
              'Authorization': `Bearer ${googleToken}`,
              'Content-Type': 'application/json'
            }
          });

          if (peopleResponse.ok) {
            const peopleData = await peopleResponse.json();
            if (peopleData.birthdays && peopleData.birthdays.length > 0) {
              const birthday = peopleData.birthdays[0].date;
              if (birthday && birthday.month && birthday.day) {
                // Formátum: MM-DD (év nélkül, mert az gyakran hiányzik)
                const month = String(birthday.month).padStart(2, '0');
                const day = String(birthday.day).padStart(2, '0');
                collectedData.googleData.birthday = `${month}-${day}`;
                console.log('✅ Születési dátum lekérve (nem logolva).');
              }
            }
          } else {
            console.warn('⚠️ Google People API hiba:', peopleResponse.status);
          }
        } catch (peopleError) {
          console.warn('⚠️ Google People API nem elérhető:', peopleError);
        }

        // BirthDate ellenőrzés és popup megjelenítése szükség esetén
        const userData = { birthDate: collectedData.googleData.birthday || '' };
        checkBirthDateAndShowPopup(userData);

        // Mentés localStorage-ba (kompatibilitás) – érzékeny adatok (születésnap) kihagyásával.
        // A birthday csak munkamenet-szintű memóriában él; a Firestore-ba kerül titkosítás nélkül
        // de ott a Firestore biztonsági szabályok védenek. localStorage-ban nem tároljuk.
        const { birthday: _omitBirthday, ...googleDataSafe } = collectedData.googleData;
        localStorage.setItem('eu2k-google-data', JSON.stringify(googleDataSafe));
      } else {
        console.warn('⚠️ Google API hiba:', userinfoResponse.status);
      }
    }
  } catch (error) {
    console.error('❌ Google API hiba:', error);
  }
}

/**
 * "Kezdjük" gomb event listener beállítása
 */
function setupStartButton(auth, db) {
  // Várunk, hogy a DOM betöltődjön
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      attachStartButtonListener(auth, db);
    });
  } else {
    attachStartButtonListener(auth, db);
  }
}

/**
 * "Kezdjük" gomb listener csatolása
 */
function attachStartButtonListener(auth, db) {
  // Keresés különböző lehetséges gomb szelektorokkal
  const possibleSelectors = [
    'button[onclick*="checkTermsAndRedirect"]',
    '.start-button',
    '#start-button',
    'button:contains("Kezdjük")',
    'button[data-action="start"]'
  ];

  let startButton = null;
  for (const selector of possibleSelectors) {
    startButton = document.querySelector(selector);
    if (startButton) break;
  }

  if (startButton) {
    console.log('🎯 "Kezdjük" gomb megtalálva');

    // Eredeti onclick eltávolítása és új handler hozzáadása
    startButton.removeAttribute('onclick');
    startButton.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('🚀 "Kezdjük" gomb megnyomva - onboarding finalizálása...');

      const success = await completeOnboarding(auth, db);
      if (success) {
        // Eredeti navigációs logika
        if (window.welcomeScreenManager) {
          window.welcomeScreenManager.markAsVisited();
          window.welcomeScreenManager.returnFromWelcomeScreen();
        } else {
          window.location.href = '/EU2K-Hub/index.html';
        }
      } else {
        if (window.showToastDirectly) {
          window.showToastDirectly('Hiba', 'Hiba történt az onboarding befejezése során. Kérlek próbáld újra!', 'danger', 'info');
        } else if (window.showNotification) {
          await window.showNotification('Hiba történt az onboarding befejezése során. Kérlek próbáld újra!', 'Hiba', 'danger');
        } else {
          alert('Hiba történt az onboarding befejezése során. Kérlek próbáld újra!');
        }
      }
    });
  } else {
    console.warn('⚠️ "Kezdjük" gomb nem található');
  }
}

/**
 * Onboarding befejezése - Firestore dokumentumok létrehozása
 * @param {Object} auth - Firebase Auth instance
 * @param {Object} db - Firestore database instance
 * @returns {Promise<boolean>} - Sikeres volt-e a művelet
 */
export async function completeOnboarding(auth, db) {
  try {
    const user = collectedData.userInfo || auth.currentUser;
    if (!user) {
      console.error('❌ Nincs bejelentkezett felhasználó!');
      return false;
    }

    const uid = user.uid;
    console.log('🚀 Onboarding befejezése...', uid);
    console.log('📊 Gyűjtött adatok:', collectedData);

    // 1. Először létrehozzuk a users/{uid} szülő dokumentumot
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, {
      uid: uid,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    }, { merge: true });
    console.log('✅ User fő dokumentum létrehozva');

    // 2. Felhasználó típus meghatározása a gyűjtött adatok alapján
    let accessLevel = 'basic';
    let accountType = 'school'; // default diák
    let jobTitle = '';
    let displayName = '';
    let email = '';
    let birthDate = '';

    // Onboarding típus használata
    if (collectedData.onboardingType === 'teacher') {
      accessLevel = 'teacher';
      accountType = 'teacher';
    } else if (collectedData.onboardingType === 'parent') {
      accessLevel = 'parent'; // Javítva: 'owner' helyett 'parent'
      accountType = 'parent';
    } else {
      // student
      accessLevel = 'basic';
      accountType = 'school';
    }

    // 3. Microsoft Graph API adatok feldolgozása
    if (collectedData.graphData) {
      const parsedData = collectedData.graphData;
      displayName = parsedData.displayName || '';
      email = parsedData.mail || '';

      if (accountType === 'school' && parsedData.jobTitle) {
        // Diák esetén osztály kiszámítása (2030: 8., 2029: 9., stb.)
        const currentYear = new Date().getFullYear();
        const match = parsedData.jobTitle.match(/(\d{4})([A-Z]?)/);
        if (match) {
          const graduationYear = parseInt(match[1]);
          const classLetter = match[2] || '';
          const grade = Math.max(7, Math.min(12, 19 - (graduationYear - currentYear)));
          jobTitle = `${grade}.${classLetter}`;
        }
      } else if (accountType === 'teacher') {
        // Tanár esetén a jobTitle értéke
        jobTitle = parsedData.jobTitle || '';
      }
    }

    // 4. Google API adatok feldolgozása
    if (collectedData.googleData) {
      const parsedData = collectedData.googleData;
      if (parsedData.displayName) {
        // Vezetéknév + keresztnév sorrendben
        const nameParts = parsedData.displayName.split(' ');
        if (nameParts.length >= 2) {
          const firstName = nameParts[0];
          const lastName = nameParts.slice(1).join(' ');
          displayName = `${lastName} ${firstName}`;
        } else {
          displayName = parsedData.displayName;
        }
      }
      email = parsedData.email || '';

      // BirthDate kitöltése Google adatokból (ha elérhető)
      if (parsedData.birthday) {
        birthDate = parsedData.birthday;
      }

      if (accountType === 'parent') {
        jobTitle = 'Szülő';
      }
    }

    // 5. Onboarding beállítások lekérése localStorage-ból
    const useSchoolPfp = localStorage.getItem('eu2k-onboarding-use-provided-pfp') === 'true' || localStorage.getItem('useSchoolPfp') === 'true';
    const selectedAvatar = localStorage.getItem('eu2k-onboarding-avatar') || localStorage.getItem('selectedAvatar') || 'magenta';
    const termsAccepted = localStorage.getItem('eu2k-onboarding-terms-accepted') === 'true' || localStorage.getItem('termsAccepted') === 'true';

    // Notification és message beállítások
    let notificationSettings = {};
    let messageSettings = {};

    try {
      const savedNotifications = localStorage.getItem('eu2k-onboarding-notifications');
      if (savedNotifications) {
        notificationSettings = JSON.parse(savedNotifications);
      }

      const savedMessages = localStorage.getItem('eu2k-onboarding-messages');
      if (savedMessages) {
        messageSettings = JSON.parse(savedMessages);
      }
    } catch (error) {
      console.error('❌ Error parsing onboarding settings:', error);
    }

    // 6. General dokumentum payload összeállítása
    const payload = {
      accessLevel: accessLevel,
      accountType: accountType,
      birthDate: birthDate, // Google adatokból vagy üres
      displayName: displayName || user.displayName || localStorage.getItem('eu2k-auth-display-name') || '',
      email: email || user.email || '',
      jobTitle: jobTitle,
      useProvidedPfp: useSchoolPfp, // true ha "Tovább az iskolai profilképpel" gombot nyomták
      pfpColor: useSchoolPfp ? '' : selectedAvatar, // üres ha iskolai pfp, egyébként a kiválasztott szín
      selectedAvatar: useSchoolPfp ? null : selectedAvatar,
      termsAccepted: termsAccepted ? 'true' : 'false',
      notificationSettings: notificationSettings,
      messageSettings: messageSettings,
      uid: user.uid || null,
      onboardingCompleted: true,
      welcomeScreenVisited: true,
      createdAt: new Date().toISOString(),
      comment: 'General profile document created at the end of onboarding with security layer data.'
    };

    // PhotoURL hozzáadása Google vagy Firebase Auth adatokból
    let photoURL = null;
    if (useSchoolPfp) {
      // Ha iskolai profilképet használunk, próbáljuk meg lekérni a localStorage-ból
      const schoolPhotoUrl = localStorage.getItem('eu2k-onboarding-school-photo-url') ||
        localStorage.getItem('eu2k-google-profile-url') ||
        localStorage.getItem('eu2k-profile-picture-url');
      if (schoolPhotoUrl) {
        photoURL = schoolPhotoUrl;
        console.log('🖼️ Iskolai profilkép URL hozzáadva:', photoURL);
      }
    } else if (collectedData.googleData && collectedData.googleData.picture) {
      photoURL = collectedData.googleData.picture;
      console.log('🖼️ Google profilkép URL hozzáadva:', photoURL);
    } else if (user.photoURL) {
      photoURL = user.photoURL;
      console.log('🖼️ Firebase Auth profilkép URL hozzáadva:', photoURL);
    }

    if (photoURL) {
      payload.photoURL = photoURL;
    }

    // Ha useProvidedPfp be van állítva, mentjük a profil URL-jét is
    if (useSchoolPfp) {
      const googleProfileUrl = localStorage.getItem('eu2k-google-profile-url');
      if (googleProfileUrl) {
        payload.profilePictureUrl = googleProfileUrl;
        console.log('🖼️ Profile URL added to payload:', googleProfileUrl);
      }
    }

    // 7. General dokumentum létrehozása
    const generalRef = doc(db, 'users', uid, 'general_data', 'general');
    await setDoc(generalRef, payload, { merge: true });
    console.log('✅ General profile document saved for user:', uid);
    console.log('📄 Payload:', payload);

    // 8. Onboarding security adatok törlése localStorage-ból
    localStorage.removeItem('eu2k-onboarding-avatar');
    localStorage.removeItem('eu2k-onboarding-use-provided-pfp');
    localStorage.removeItem('eu2k-onboarding-profile-confirmed');
    localStorage.removeItem('eu2k-onboarding-notifications');
    localStorage.removeItem('eu2k-onboarding-messages');
    localStorage.removeItem('eu2k-onboarding-terms-accepted');
    localStorage.removeItem('eu2k-google-profile-url');

    // További localStorage elemek törlése
    localStorage.removeItem('eu2k-onboarding-target');
    localStorage.removeItem('eu2k-auth-start-time');
    localStorage.removeItem('eu2k-debug-logs');
    localStorage.removeItem('GDPR_REMOVAL_FLAG');

    // 9. Custom claims beállítása Firebase Functions segítségével
    try {
      console.log('🔧 Custom claims beállítása...');
      const functions = getFunctions();
      const setCustomClaims = httpsCallable(functions, 'setCustomClaims');

      // Role meghatározása accessLevel alapján
      let role = 'student';
      if (accessLevel === 'teacher') role = 'teacher';
      else if (accessLevel === 'admin') role = 'admin';
      else if (accessLevel === 'parent') role = 'parent';
      else if (accessLevel === 'owner') role = 'owner';

      await setCustomClaims({ userId: uid, role: role });
      console.log(`✅ Custom claims beállítva: ${role}`);
    } catch (claimsError) {
      console.warn('⚠️ Custom claims beállítása sikertelen (Functions lehet hogy nincs telepítve):', claimsError.message);
      // Ne állítsuk meg az onboarding-ot ha a claims beállítása sikertelen
    }

    console.log('🎉 Onboarding sikeresen befejezve!');
    return true;

  } catch (error) {
    console.error('❌ Onboarding hiba:', error);
    return false;
  }
}
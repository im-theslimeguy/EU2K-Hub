/**
 * Day-dependent greetings
 * Shows time-based greetings in header titles
 * Runs BEFORE the loading screen disappears
 */

(function() {
  'use strict';

  let originalTitle = null;
  let translatedTitle = null;
  let greetingTimeout = null;
  let greetingShown = false;

  /**
   * Get translation helper
   */
  function getTranslation(key, fallback) {
    try {
      const result = window.translationManager?.getTranslation(key);
      return result || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Get greeting based on current time
   */
  function getGreeting(fullName) {
    const now = new Date();
    const hour = now.getHours();
    
    if (hour >= 17 || hour < 6) {
      const template = getTranslation('greetings.evening', 'Jóestét {name}!');
      return template.replace('{name}', fullName);
    } else if (hour >= 6 && hour < 10) {
      const template = getTranslation('greetings.morning', 'Jóreggelt {name}!');
      return template.replace('{name}', fullName);
    } else if (hour >= 10 && hour < 17) {
      const template = getTranslation('greetings.afternoon', 'Jónapot {name}!');
      return template.replace('{name}', fullName);
    }
    const template = getTranslation('greetings.afternoon', 'Jónapot {name}!');
    return template.replace('{name}', fullName);
  }

  /**
   * Show greeting in header - runs early, before loader disappears
   */
  async function showGreeting() {
    if (greetingShown) return;
    
    try {
      // Wait for Firebase (short timeout - we want to be fast)
      let retries = 0;
      while (!window.firebaseApp && retries < 30) {
        await new Promise(resolve => setTimeout(resolve, 50));
        retries++;
      }

      if (!window.firebaseApp) {
        console.warn('[DayGreetings] Firebase app not available');
        return;
      }

      const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
      const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
      
      const auth = getAuth(window.firebaseApp);
      const db = getFirestore(window.firebaseApp);

      // Wait for auth state (short timeout)
      let authResolved = false;
      await Promise.race([
        new Promise((resolve) => {
          if (auth.currentUser) {
            authResolved = true;
            resolve();
          } else {
            const unsubscribe = auth.onAuthStateChanged((user) => {
              unsubscribe();
              authResolved = true;
              resolve();
            });
          }
        }),
        new Promise(resolve => setTimeout(resolve, 2000)) // 2s timeout
      ]);

      if (!auth.currentUser) {
        return;
      }

      // Check if dayDependentGreetings is enabled
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userSnap = await getDoc(userRef);
      let userData = userSnap.exists() ? (userSnap.data() || {}) : {};

      // Fallback: fullName gyakran a general_data/general dokumentumban van
      if (!userData.fullName) {
        try {
          const generalRef = doc(db, 'users', auth.currentUser.uid, 'general_data', 'general');
          const generalSnap = await getDoc(generalRef);
          if (generalSnap.exists()) {
            userData = { ...generalSnap.data(), ...userData };
          }
        } catch (e) {
          console.warn('[DayGreetings] Could not load general_data/general:', e);
        }
      }

      // Ha a flag hiányzik, tekintsük bekapcsoltnak (localhost/dev fallback)
      if (userData.dayDependentGreetings === false) {
        return;
      }

      const fullName = userData.fullName || userData.displayName || userData.nickname || auth.currentUser.displayName || '';
      if (!fullName) {
        return;
      }

      // Get display time from users/{userid}/settings/functions (default 2 seconds)
      let displayTime = 2000;
      try {
        const functionsRef = doc(db, 'users', auth.currentUser.uid, 'settings', 'functions');
        const functionsSnap = await getDoc(functionsRef);
        if (functionsSnap.exists()) {
          const functionsData = functionsSnap.data();
          displayTime = (functionsData.ddgDisappearingTime || 2) * 1000;
        }
      } catch (e) {
        console.warn('[DayGreetings] Could not load ddgDisappearingTime:', e);
      }

      // Find welcome-text element
      const welcomeText = document.querySelector('.welcome-text');
      if (!welcomeText) {
        return;
      }

      greetingShown = true;

      // Get the translation key from the element
      const translateKey = welcomeText.getAttribute('data-translate');
      
      // Store original title
      if (originalTitle === null) {
        originalTitle = welcomeText.textContent.trim();
      }
      
      // Get translated title in background (for when greeting fades out)
      translatedTitle = originalTitle;
      
      // Try to get translated title - keep checking in background
      const updateTranslatedTitle = () => {
        if (translateKey && window.translationManager && window.translationManager.isInitialized) {
          const translated = window.translationManager.getTranslation(translateKey);
          if (translated && translated !== translateKey) {
            translatedTitle = translated;
          }
        }
      };
      
      // Check immediately and set up interval to keep checking
      updateTranslatedTitle();
      const translationCheckInterval = setInterval(() => {
        updateTranslatedTitle();
        if (window.__eu2kTranslationsApplied) {
          clearInterval(translationCheckInterval);
        }
      }, 100);

      // Get greeting
      const greeting = getGreeting(fullName);

      // Set greeting immediately (no initial fade - will be visible when loader fades)
      welcomeText.textContent = greeting;

      // On index.html, keep greeting forever (don't fade back)
      const currentPage = window.location.pathname.split('/').pop();
      const isIndexPage = currentPage === 'index.html' || currentPage === '' || window.location.pathname === '/' || window.location.pathname.endsWith('/');
      
      if (isIndexPage) {
        clearInterval(translationCheckInterval);
        return; // Keep greeting on index forever
      }

      // On other pages, fade back to translated title after displayTime
      if (greetingTimeout) {
        clearTimeout(greetingTimeout);
      }

      greetingTimeout = setTimeout(() => {
        if (welcomeText) {
          // Fade out with slide right animation
          welcomeText.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
          welcomeText.style.opacity = '0';
          welcomeText.style.transform = 'translateX(30px)';
          
          setTimeout(() => {
            // Update final translated title one more time
            updateTranslatedTitle();
            clearInterval(translationCheckInterval);
            
            // Reset position for fade in
            welcomeText.style.transition = 'none';
            welcomeText.style.transform = 'translateX(-30px)';
            welcomeText.textContent = translatedTitle;
            
            // Force reflow
            welcomeText.offsetHeight;
            
            // Fade in with slide from left animation
            welcomeText.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
            welcomeText.style.opacity = '1';
            welcomeText.style.transform = 'translateX(0)';
          }, 400);
        }
      }, displayTime);

    } catch (error) {
      console.error('[DayGreetings] Error showing greeting:', error);
    }
  }

  // Start immediately - don't wait for DOMContentLoaded
  // This ensures we run BEFORE the loader disappears
  if (document.readyState === 'loading') {
    // DOM not ready yet, wait for it
    document.addEventListener('DOMContentLoaded', () => {
      // Run immediately when DOM is ready
      showGreeting();
    });
  } else {
    // DOM already ready, run now
    showGreeting();
  }

  // Export for global access
  window.dayGreetings = {
    show: showGreeting
  };
})();


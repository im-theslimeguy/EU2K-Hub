/**
 * Staff Navigation Items
 * Dynamically shows/hides Dashboard and Diákjaim nav items based on session
 */

(function() {
  'use strict';

  // Ne injectáljon ott, ahol a gombok statikusan vannak/legyenek
  const currentPath = (window.location.pathname || '').toLowerCase();
  const currentPage = currentPath.split('/').pop();
  const shouldSkip =
    currentPage === 'settings.html' ||
    currentPage === 'settings' ||
    currentPage === 'dashboard.html' ||
    currentPage === 'dashboard' ||
    currentPage === 'students.html' ||
    currentPage === 'students';

  if (shouldSkip) {
    console.log('[StaffNavItems] Static nav page detected (no injection):', currentPage);
  }

  /**
   * Initialize staff nav items
   */
  async function initStaffNavItems() {
    if (shouldSkip) {
      // Ezeken az oldalakon a nav elemek statikusan vannak a HTML-ben.
      // A modul exportjai ettől még maradjanak elérhetők más scripteknek.
      return;
    }
    try {
      // Check if session is active
      const isActive = await checkActiveSession();
      
      if (isActive) {
        showStaffNavItems();
      } else {
        hideStaffNavItems();
      }
    } catch (error) {
      console.error('[StaffNavItems] Error initializing:', error);
    }
  }

  /**
   * Check if staff session is active
   */
  async function checkActiveSession() {
    try {
      // Wait for Firebase to be available
      let retries = 0;
      while ((!window.firebaseApp) && retries < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }

      if (!window.firebaseApp) {
        console.error('[StaffNavItems] Firebase not available');
        return false;
      }

      const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
      const auth = getAuth(window.firebaseApp);

      // Wait for auth state
      await new Promise((resolve) => {
        if (auth.currentUser) {
          resolve();
        } else {
          const unsubscribe = auth.onAuthStateChanged(() => {
            unsubscribe();
            resolve();
          });
        }
      });

      if (!auth.currentUser) {
        console.log('[StaffNavItems] No user logged in');
        return false;
      }

      // Get custom claims
      const idTokenResult = await auth.currentUser.getIdTokenResult();
      const claims = idTokenResult.claims;

      console.log('[StaffNavItems] User claims:', { admin: claims.admin, owner: claims.owner, teacher: claims.teacher });

      // Must be staff
      if (!claims.admin && !claims.owner && !claims.teacher) {
        console.log('[StaffNavItems] User is not staff');
        return false;
      }

      // Check session
      const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
      const functions = getFunctions(window.firebaseApp, 'europe-west1');
      const checkSession = httpsCallable(functions, 'staffSessionCheck');

      console.log('[StaffNavItems] Checking session...');
      const result = await checkSession();
      console.log('[StaffNavItems] Session active:', result.data.active);
      
      return result.data.active || false;
    } catch (error) {
      console.error('[StaffNavItems] Error checking session:', error);
      return false;
    }
  }

  /**
   * Show staff nav items
   */
  function showStaffNavItems() {
    const navRail = document.querySelector('.nav-rail');
    if (!navRail) return;

    // Get current page
    const currentPage = window.location.pathname.split('/').pop();
    const isDashboard = currentPage === 'dashboard.html';
    const isStudents = currentPage === 'students.html';

    // Check if items already exist
    const existingDashboard = document.getElementById('staffDashboardNav');
    const existingStudents = document.getElementById('staffStudentsNav');
    
    if (existingDashboard || existingStudents) {
      // Update is-active class if items already exist
      if (existingDashboard) {
        if (isDashboard) {
          existingDashboard.classList.add('is-active');
          existingDashboard.setAttribute('aria-current', 'page');
        } else {
          existingDashboard.classList.remove('is-active');
          existingDashboard.removeAttribute('aria-current');
        }
      }
      if (existingStudents) {
        if (isStudents) {
          existingStudents.classList.add('is-active');
          existingStudents.setAttribute('aria-current', 'page');
        } else {
          existingStudents.classList.remove('is-active');
          existingStudents.removeAttribute('aria-current');
        }
      }
      return;
    }

    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    // Create Dashboard nav item
    const dashboardItem = document.createElement('a');
    dashboardItem.id = 'staffDashboardNav';
    dashboardItem.className = 'rail-item nav-btn staff-nav-item' + (isDashboard ? ' is-active' : '');
    dashboardItem.href = 'dashboard.html';
    if (isDashboard) {
      dashboardItem.setAttribute('aria-current', 'page');
    }
    dashboardItem.innerHTML = `
      <div class="rail-icon">
        <img src="assets/navbar/dashboard.svg" alt="Dashboard" />
      </div>
      <span class="rail-label" data-translate="navigation.dashboard">Dashboard</span>
    `;

    // Create Diákjaim nav item
    const studentsItem = document.createElement('a');
    studentsItem.id = 'staffStudentsNav';
    studentsItem.className = 'rail-item nav-btn staff-nav-item' + (isStudents ? ' is-active' : '');
    studentsItem.href = 'students.html';
    if (isStudents) {
      studentsItem.setAttribute('aria-current', 'page');
    }
    studentsItem.innerHTML = `
      <div class="rail-icon">
        <img src="assets/navbar/students.svg" alt="Diákjaim" />
      </div>
      <span class="rail-label" data-translate="navigation.students">Diákjaim</span>
    `;

    // Find YouHub item to insert after
    const youhubItem = Array.from(navRail.querySelectorAll('.rail-item')).find(item => 
      item.getAttribute('href') === 'youhub.html'
    );

    if (youhubItem) {
      // Insert after YouHub
      youhubItem.insertAdjacentElement('afterend', dashboardItem);
      dashboardItem.insertAdjacentElement('afterend', studentsItem);
    } else {
      // Append at end
      navRail.appendChild(dashboardItem);
      navRail.appendChild(studentsItem);
    }

    // Apply translations if available
    if (window.translationManager) {
      window.translationManager.applyTranslations?.();
    }
  }

  /**
   * Hide staff nav items
   */
  function hideStaffNavItems() {
    const dashboardItem = document.getElementById('staffDashboardNav');
    const studentsItem = document.getElementById('staffStudentsNav');

    if (dashboardItem) {
      dashboardItem.remove();
    }

    if (studentsItem) {
      studentsItem.remove();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStaffNavItems);
  } else {
    initStaffNavItems();
  }

  // Export for global access
  window.staffNavItems = {
    show: showStaffNavItems,
    hide: hideStaffNavItems,
    refresh: initStaffNavItems
  };
})();


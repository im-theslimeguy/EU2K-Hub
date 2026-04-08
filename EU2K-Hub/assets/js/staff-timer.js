/**
 * Staff Session Timer
 * Displays and synchronizes session countdown timer
 */

(function() {
  'use strict';

  let timerElement = null;
  let timerInterval = null;
  let sessionEndTime = null;
  let syncInterval = null;
  let syncCounter = 0;
  let deviceId = null;
  let sessionReplaced = false;

  /**
   * Get or create device ID
   */
  function getDeviceId() {
    if (!deviceId) {
      // Try to get from localStorage
      deviceId = localStorage.getItem('eu2k_device_id');
      if (!deviceId) {
        // Generate new device ID
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('eu2k_device_id', deviceId);
        console.log('[StaffTimer] Generated new device ID:', deviceId);
      } else {
        console.log('[StaffTimer] Using existing device ID:', deviceId);
      }
    }
    return deviceId;
  }

  /**
   * Initialize timer
   */
  function initTimer() {
    // Prevent multiple initializations
    if (window._staffTimerInitialized) {
      console.log('[StaffTimer] Already initialized, skipping...');
      return;
    }
    window._staffTimerInitialized = true;
    
    console.log('[StaffTimer] 🚀 Initializing timer...');
    // Get device ID
    getDeviceId();
    // Don't create timer element until we know there's an active session
    // Check if session is active first
    checkAndStartTimer();
  }

  /**
   * Check if session is active and start timer
   * Always runs and redirects if no active session
   */
  async function checkAndStartTimer() {
    try {
      // Wait for Firebase to be available
      let retries = 0;
      while (!window.firebaseApp && retries < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }

      if (!window.firebaseApp) {
        console.warn('[StaffTimer] Firebase app not available');
        return;
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
        return;
      }

      const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
      const functions = getFunctions(window.firebaseApp, 'europe-west1');
      const checkSession = httpsCallable(functions, 'staffSessionCheck');

      const result = await checkSession({ deviceId: getDeviceId() });
      console.log('[StaffTimer] 🔄 Session check result:', result.data);
      console.log('[StaffTimer] 📊 Device ID:', getDeviceId());
      console.log('[StaffTimer] ⏰ Current time:', new Date().toISOString());
      
      // Check if transfer is available (new device, session active on other device)
      if (result.data.transferAvailable && !result.data.active) {
        console.log('[StaffTimer] ⚠️ Session active on another device, showing transfer notification');
        handleTransferAvailable(result.data);
        return;
      }
      
      // Check if transfer was requested (new device requested transfer)
      if (result.data.transferRequested && !result.data.active) {
        console.log('[StaffTimer] ⚠️ Transfer requested, waiting for approval');
        handleTransferRequested(result.data);
        return;
      }
      
      // Check if current device has active session and transfer was requested
      if (result.data.transferRequested && result.data.active) {
        console.log('[StaffTimer] ⚠️ Another device requested transfer');
        handleTransferRequestedOnActiveDevice(result.data);
      }
      
      if (result.data.active) {
        console.log('[StaffTimer] ✅ Session is active, starting timer with endTime:', result.data.endTime);
        console.log('[StaffTimer] ⏰ EndTime as date:', new Date(result.data.endTime).toISOString());
        console.log('[StaffTimer] ⏰ Current time (ms):', Date.now());
        console.log('[StaffTimer] ⏰ EndTime (ms):', result.data.endTime);
        console.log('[StaffTimer] ⏰ Remaining seconds:', Math.floor((result.data.endTime - Date.now()) / 1000));
        startTimer(result.data.endTime);
      } else {
        console.log('[StaffTimer] ❌ Session is not active');
        // No active session - hide timer completely
        if (timerElement) {
          timerElement.style.display = 'none';
        }
        // Stop counting
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        if (syncInterval) {
          clearInterval(syncInterval);
          syncInterval = null;
        }
        sessionEndTime = null;
        
        // Check if we're on a protected page
        const currentPage = window.location.pathname.split('/').pop();
        if (currentPage === 'dashboard.html' || currentPage === 'students.html') {
          handleSessionExpired();
        } else {
          // On other pages, just hide nav items
          if (window.staffNavItems && window.staffNavItems.hide) {
            window.staffNavItems.hide();
          }
        }
      }
    } catch (error) {
      console.error('[StaffTimer] Error checking session:', error);
      // On error, also redirect if we're on a protected page
      const currentPage = window.location.pathname.split('/').pop();
      if (currentPage === 'dashboard.html' || currentPage === 'students.html') {
        handleSessionExpired();
      }
    }
  }

  /**
   * Start timer with given end time
   */
  function startTimer(endTime) {
    console.log('[StaffTimer] 🚀 startTimer called with endTime:', endTime);
    console.log('[StaffTimer] ⏰ EndTime as date:', new Date(endTime).toISOString());
    console.log('[StaffTimer] ⏰ Current sessionEndTime:', sessionEndTime);
    console.log('[StaffTimer] ⏰ Difference (seconds):', Math.floor((endTime - Date.now()) / 1000));
    
    sessionEndTime = endTime;
    
    // Create timer element if not exists
    if (!timerElement || !document.getElementById('staffSessionTimer')) {
      createTimerElement();
      
      // Wait for timer element to be created (with retry)
      let retries = 0;
      const maxRetries = 50; // 5 seconds
      const waitForElement = () => {
        timerElement = document.getElementById('staffSessionTimer');
        if (timerElement) {
          // Element created, show it
          timerElement.style.display = 'flex';
          console.log('[StaffTimer] Timer element found and displayed');
        } else {
          retries++;
          if (retries < maxRetries) {
            setTimeout(waitForElement, 100);
            return;
          }
          console.error('[StaffTimer] Timer element not created after', maxRetries, 'retries');
        }
      };
      waitForElement();
    } else {
      // Element already exists, just show it with full opacity when active
      timerElement.style.display = 'flex';
      timerElement.style.opacity = '1';
      console.log('[StaffTimer] Timer element already exists, displaying');
    }
    
    // Mobil timer megjelenítése is
    if (window.innerWidth <= 700) {
      createMobileTimerElement();
      if (mobileTimerElement) {
        mobileTimerElement.style.display = 'flex';
      }
    }

    // Start countdown
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer(); // Initial update

    // Start sync every minute
    if (syncInterval) {
      clearInterval(syncInterval);
    }
    
    syncInterval = setInterval(syncWithServer, 30000); // Every 30 seconds
  }

  /**
   * Stop timer
   */
  function stopTimer() {
    sessionEndTime = null;
    
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    // Hide timer element completely when stopped
    if (timerElement) {
      timerElement.style.display = 'none';
    }
    
    // Hide mobile timer element too
    if (mobileTimerElement) {
      mobileTimerElement.style.display = 'none';
    }

    syncCounter = 0;
  }

  /**
   * Create timer element in the DOM
   */
  function createTimerElement() {
    // If already exists, return
    if (timerElement && document.getElementById('staffSessionTimer')) {
      return;
    }

    // Try to find header icon container with retry
    let retries = 0;
    const maxRetries = 50; // 5 seconds
    
    const tryCreate = () => {
      // Find the settings button wrapper (to insert timer before it)
      const settingsWrapper = document.querySelector('#headerSettingsWrapper') ||
                            document.querySelector('[id*="Settings"]') ||
                            document.querySelector('.header-icon-wrapper[id*="settings"]') ||
                            document.querySelector('.header-icon-wrapper');
      
      // Also try to find header-icon-gradient or header-icon-container
      const gradientContainer = document.querySelector('.header-icon-gradient') ||
                               document.querySelector('.header-icon-container');
      
      if (!settingsWrapper && !gradientContainer) {
        retries++;
        if (retries < maxRetries) {
          setTimeout(tryCreate, 100);
          return;
        }
        console.warn('[StaffTimer] Settings wrapper or gradient container not found after', maxRetries, 'retries');
        return;
      }

      // Create timer element
      timerElement = document.createElement('div');
      timerElement.id = 'staffSessionTimer';
      timerElement.style.cssText = `
        display: none;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        background: var(--background-button-secondary);
        border-radius: 16px;
        padding: 6px 12px;
        margin-right: 8px;
        color: #182C0E;
        font-size: 14px;
        font-weight: 600;
        z-index: 400;
        transition: all 0.3s ease;
      `;

      timerElement.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="#182C0E" stroke-width="2"/>
          <path d="M8 4V8L11 11" stroke="#182C0E" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span id="staffTimerText">15:00</span>
      `;

      // Insert before settings wrapper if found, otherwise at the beginning of gradient container
      if (settingsWrapper && settingsWrapper.parentElement) {
        settingsWrapper.parentElement.insertBefore(timerElement, settingsWrapper);
        console.log('[StaffTimer] ✅ Timer element created and inserted before settings button');
      } else if (gradientContainer) {
        gradientContainer.insertBefore(timerElement, gradientContainer.firstChild);
        console.log('[StaffTimer] ✅ Timer element created and inserted at beginning of gradient container');
      } else {
        console.error('[StaffTimer] ❌ Could not find insertion point for timer element');
        // Last resort: try to append to header-icon-container
        const iconContainer = document.querySelector('.header-icon-container');
        if (iconContainer) {
          const gradient = iconContainer.querySelector('.header-icon-gradient');
          if (gradient) {
            gradient.insertBefore(timerElement, gradient.firstChild);
            console.log('[StaffTimer] ✅ Timer element inserted as last resort');
          }
        }
      }
      
      // Mobilban: timer hozzáadása a hamburger menühöz is
      if (window.innerWidth <= 700) {
        createMobileTimerElement();
      }
      
      // Resize listener a mobil timer megjelenítéséhez/elrejtéséhez
      window.addEventListener('resize', () => {
        if (window.innerWidth <= 700 && timerElement) {
          createMobileTimerElement();
        } else if (window.innerWidth > 700) {
          removeMobileTimerElement();
        }
      });
      
      // Make sure timer element is stored
      if (timerElement) {
        console.log('[StaffTimer] Timer element ID:', timerElement.id, 'Display:', timerElement.style.display);
      }
    };
    
    tryCreate();
  }

  /**
   * Create mobile timer element in hamburger menu
   */
  let mobileTimerElement = null;
  function createMobileTimerElement() {
    // Ha már létezik, ne hozzuk létre újra
    if (mobileTimerElement && document.getElementById('staffSessionTimerMobile')) {
      return;
    }
    
    const hamburgerMenu = document.getElementById('hamburgerMenuDropdown');
    if (!hamburgerMenu) {
      // Várjunk egy kicsit, ha még nincs a hamburger menü
      setTimeout(createMobileTimerElement, 100);
      return;
    }
    
    // Ha már létezik a mobil timer, ne hozzuk létre újra
    if (document.getElementById('staffSessionTimerMobile')) {
      mobileTimerElement = document.getElementById('staffSessionTimerMobile');
      return;
    }
    
    // Létrehozzuk a mobil timer elemet
    mobileTimerElement = document.createElement('div');
    mobileTimerElement.id = 'staffSessionTimerMobile';
    mobileTimerElement.style.cssText = `
      display: none;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      background: var(--background-button-secondary);
      border-radius: 16px;
      padding: 6px 12px;
      margin-bottom: 8px;
      color: #182C0E;
      font-size: 14px;
      font-weight: 600;
      width: 100%;
      box-sizing: border-box;
      transition: all 0.3s ease;
    `;
    
    mobileTimerElement.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="7" stroke="#182C0E" stroke-width="2"/>
        <path d="M8 4V8L11 11" stroke="#182C0E" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span id="staffTimerTextMobile">15:00</span>
    `;
    
    // Beszúrjuk a hamburger menü elejére (bal oldal)
    hamburgerMenu.insertBefore(mobileTimerElement, hamburgerMenu.firstChild);
    console.log('[StaffTimer] ✅ Mobile timer element created in hamburger menu');
    
    // Ha a desktop timer látható, akkor a mobil is legyen
    if (timerElement && timerElement.style.display !== 'none') {
      mobileTimerElement.style.display = 'flex';
    }
  }
  
  /**
   * Remove mobile timer element
   */
  function removeMobileTimerElement() {
    if (mobileTimerElement && mobileTimerElement.parentElement) {
      mobileTimerElement.remove();
      mobileTimerElement = null;
    }
  }

  /**
   * Update timer display
   */
  function updateTimer() {
    if (!sessionEndTime || !timerElement) {
      return;
    }

    const now = Date.now();
    const remaining = sessionEndTime - now;
    
    // Log occasionally (every 10 seconds)
    if (Math.floor(remaining / 1000) % 10 === 0) {
      console.log('[StaffTimer] ⏰ Timer update - Remaining:', Math.floor(remaining / 1000), 'seconds');
    }

    if (remaining <= 0) {
      // Session expired
      stopTimer();
      handleSessionExpired();
      return;
    }

    // Calculate minutes and seconds
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    // Update display (desktop)
    const timerText = document.getElementById('staffTimerText');
    if (timerText) {
      timerText.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    // Update display (mobile)
    const timerTextMobile = document.getElementById('staffTimerTextMobile');
    if (timerTextMobile) {
      timerTextMobile.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // Change color when < 5 minutes
    if (minutes < 5) {
      if (timerElement) {
        timerElement.style.background = '#FFD3A1';
        timerElement.style.color = '#4A2000';
      }
      if (mobileTimerElement) {
        mobileTimerElement.style.background = '#FFD3A1';
        mobileTimerElement.style.color = '#4A2000';
      }
    }

    // Change to red when < 2 minutes
    if (minutes < 2) {
      if (timerElement) {
        timerElement.style.background = '#FF9A9A';
        timerElement.style.color = '#4A0000';
      }
      if (mobileTimerElement) {
        mobileTimerElement.style.background = '#FF9A9A';
        mobileTimerElement.style.color = '#4A0000';
      }
    }
  }

  /**
   * Sync with server every 30 seconds
   */
  async function syncWithServer() {
    syncCounter++;
    
    // Sync 30 times (every 30 seconds for 15 minutes)
    if (syncCounter > 30) {
      return;
    }

    try {
      if (!window.firebaseApp) {
        return;
      }

      const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
      const functions = getFunctions(window.firebaseApp, 'europe-west1');
      const checkSession = httpsCallable(functions, 'staffSessionCheck');

      const result = await checkSession({ deviceId: getDeviceId() });
      console.log('[StaffTimer] 🔄 Sync check result:', result.data);
      
      // Check if session was replaced
      if (result.data.replaced && !result.data.active) {
        console.log('[StaffTimer] ⚠️ Session was replaced by another device during sync');
        stopTimer();
        handleSessionReplaced();
        return;
      }
      
      if (!result.data.active) {
        // Session ended on server
        console.log('[StaffTimer] ❌ Session ended on server');
        stopTimer();
        handleSessionExpired();
        return;
      }

      const serverEndTime = result.data.endTime;
      const clientEndTime = sessionEndTime;
      const diff = Math.abs(serverEndTime - clientEndTime);

      // If difference > 2 seconds, sync with server
      if (diff > 2000) {
        console.log('[StaffTimer] 🔄 Syncing with server. Diff:', diff, 'ms');
        console.log('[StaffTimer] 📊 Server endTime:', new Date(serverEndTime).toISOString());
        console.log('[StaffTimer] 📊 Client endTime:', new Date(clientEndTime).toISOString());
        sessionEndTime = serverEndTime;
        updateTimer();
      } else {
        console.log('[StaffTimer] ✅ Timer in sync (diff:', diff, 'ms)');
      }
      
      // Check if transfer is available or requested
      if (result.data.transferAvailable && !result.data.active) {
        console.log('[StaffTimer] ⚠️ Transfer available during sync');
        stopTimer();
        handleTransferAvailable(result.data);
        return;
      }
      
      if (result.data.transferRequested && !result.data.active) {
        console.log('[StaffTimer] ⚠️ Transfer requested during sync');
        stopTimer();
        handleTransferRequested(result.data);
        return;
      }
      
      if (result.data.transferRequested && result.data.active) {
        console.log('[StaffTimer] ⚠️ Transfer requested on active device during sync');
        handleTransferRequestedOnActiveDevice(result.data);
      }
    } catch (error) {
      console.error('[StaffTimer] Error syncing with server:', error);
    }
  }

  /**
   * Handle transfer available (new device, session active on other device)
   */
  let transferTimeout = null;
  function handleTransferAvailable(data) {
    // Stop timer and hide nav items
    stopTimer();
    if (window.staffNavItems && window.staffNavItems.hide) {
      window.staffNavItems.hide();
    }

    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    const title = getTranslation('staff_timer.transfer_available_title', 'Munkamenet aktív másik eszközön');
    const message = getTranslation('staff_timer.transfer_available_message', 'A munkameneted egy másik eszközön aktív. Átviheted ide, vagy 5 másodperc múlva megszakad a hozzáférésed.');
    const buttonLabel = getTranslation('pages.settings.staff.popup.transfer_confirm', 'Átvitel');

    // Show warning notification with transfer button
    if (window.showToastDirectly) {
      window.showToastDirectly(
        title,
        message,
        'warning',
        'info',
        buttonLabel,
        () => {
          // Open session transfer popup
          if (window.staffAccess && window.staffAccess.showSessionTransferPopup) {
            console.log('[StaffTimer] 🔄 Opening transfer popup directly...');
            window.staffAccess.showSessionTransferPopup();
          } else {
            console.log('[StaffTimer] ⚠️ staffAccess not available, navigating to settings...');
            // Save that we want to open the transfer popup
            sessionStorage.setItem('eu2k_open_transfer_popup_on_load', 'true');
            window.location.href = 'settings.html#general';
          }
        }
      );
    }

    // After 5 seconds, revoke staff access (hide nav items, stop timer)
    if (transferTimeout) {
      clearTimeout(transferTimeout);
    }
    transferTimeout = setTimeout(() => {
      console.log('[StaffTimer] ⏰ 5 seconds passed, revoking staff access');
      stopTimer();
      if (window.staffNavItems && window.staffNavItems.hide) {
        window.staffNavItems.hide();
      }
    }, 5000);
  }

  /**
   * Handle transfer requested (new device requested transfer)
   */
  function handleTransferRequested(data) {
    // Same as handleTransferAvailable, but different message
    handleTransferAvailable(data);
  }

  /**
   * Handle transfer requested on active device (host device)
   */
  function handleTransferRequestedOnActiveDevice(data) {
    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    // Store transfer request data globally so the popup can access it
    if (data.transferRequestedByDeviceId) {
      window.eu2k_transferRequestedByDeviceId = data.transferRequestedByDeviceId;
      console.log('[StaffTimer] 📱 Stored transfer requested by device:', data.transferRequestedByDeviceId);
    }

    // Check if popup already shown
    if (document.getElementById('staffSessionTransferPopupGlobal')) {
      console.log('[StaffTimer] 🔔 Transfer popup already shown');
      return;
    }

    // Show transfer popup directly (works on any page)
    console.log('[StaffTimer] 🔔 Showing transfer popup on host device');
    showTransferPopupGlobal(data.transferRequestedByDeviceId);
  }

  /**
   * Show session transfer popup (global version that works on any page)
   */
  function showTransferPopupGlobal(newDeviceId) {
    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    const scrollArea = document.querySelector('.main-scroll-area') || document.body;
    const isBodyTarget = scrollArea === document.body;
    
    // Disable scroll
    if (scrollArea) {
      if (!isBodyTarget) {
        scrollArea.scrollTo({ top: 0, behavior: 'instant' });
      }
      scrollArea.classList.add('no-scroll');
      scrollArea.classList.add('popup-active');
    }

    // Create popup HTML with fixed positioning if on body
    const popupHTML = `
      <div id="staffSessionTransferPopupGlobal" class="permission-overlay-scroll-area" style="display: none; ${isBodyTarget ? 'position: fixed;' : ''}">
        <div class="permission-container">
          <button class="permission-close-btn" id="staffSessionTransferCloseBtn">
            <img src="assets/general/close.svg" alt="Bezárás">
          </button>
          <div class="permission-content">
            <img src="assets/qr-code/hand.svg" class="permission-hand-icon" alt="Munkafolyamat átvitele">
            <h2 class="permission-title" data-translate="pages.settings.staff.popup.transfer_title" data-translate-fallback="Munkafolyamat átvitele a másik eszközre">Munkafolyamat átvitele a másik eszközre</h2>
            <p class="permission-text" data-translate="pages.settings.staff.popup.transfer_message" data-translate-fallback="Add meg a jelszavad a munkamenet átviteléhez. A régi gépen megszakad a munkameneted, és ugyanonnan folytatódik a másik gépen.">Add meg a jelszavad a munkamenet átviteléhez. A régi gépen megszakad a munkameneted, és ugyanonnan folytatódik a másik gépen.</p>
            <input type="password" id="staffSessionTransferPasswordGlobal" class="dev-mode-input" data-translate-placeholder="pages.settings.staff.popup.password_placeholder" placeholder="Jelszó">
            <button class="permission-ok-btn" id="staffSessionTransferConfirmBtn" data-translate="pages.settings.staff.popup.transfer_confirm" data-translate-fallback="Átvitel">Átvitel</button>
          </div>
        </div>
      </div>
    `;

    // Add popup to body
    if (scrollArea) {
      scrollArea.insertAdjacentHTML('beforeend', popupHTML);
    }

    setTimeout(() => {
      const popup = document.getElementById('staffSessionTransferPopupGlobal');
      if (popup) {
        popup.style.display = 'flex';
      }

      const input = document.getElementById('staffSessionTransferPasswordGlobal');
      const closeBtn = document.getElementById('staffSessionTransferCloseBtn');
      const confirmBtn = document.getElementById('staffSessionTransferConfirmBtn');

      // Focus input
      if (input) {
        setTimeout(() => input.focus(), 100);
      }

      // Close handler
      const closePopup = () => {
        if (scrollArea) {
          scrollArea.classList.remove('no-scroll');
          scrollArea.classList.remove('popup-active');
        }
        if (popup) {
          popup.remove();
        }
      };

      if (closeBtn) {
        closeBtn.addEventListener('click', closePopup);
      }

      // Confirm handler
      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          if (!input) return;
          const password = input.value;
          if (!password) return;
          
          try {
            const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
            const functions = getFunctions(window.firebaseApp, 'europe-west1');
            const transferSession = httpsCallable(functions, 'staffSessionTransfer');

            // Get the device ID that requested the transfer (new device)
            const targetDeviceId = newDeviceId || window.eu2k_transferRequestedByDeviceId || getDeviceId();
            
            console.log('[StaffTimer] 🔄 Calling staffSessionTransfer with password...');
            console.log('[StaffTimer] 📱 Current Device ID (host):', getDeviceId());
            console.log('[StaffTimer] 📱 New Device ID (target):', targetDeviceId);
            const result = await transferSession({ password, newDeviceId: targetDeviceId });
            console.log('[StaffTimer] ✅ staffSessionTransfer result:', result);
            
            if (result.data.success) {
              // On host device: end session, hide nav items, redirect to index
              console.log('[StaffTimer] ✅ Transfer successful on host device, ending session...');
              
              // Stop timer
              stopTimer();
              
              // Hide nav items
              if (window.staffNavItems && window.staffNavItems.hide) {
                window.staffNavItems.hide();
              }
              
              closePopup();
              
              // Show success message
              if (window.showToastDirectly) {
                window.showToastDirectly(
                  getTranslation('staff_timer.transfer_success_title', 'Átvitel sikeres'),
                  getTranslation('staff_timer.transfer_success_message', 'A munkamenet sikeresen át lett adva a másik eszköznek.'),
                  'positive',
                  'info'
                );
              }
              
              // Redirect to index.html after 1 second
              setTimeout(() => {
                window.location.href = '/index.html';
              }, 1000);
            } else {
              alert(getTranslation('pages.settings.staff.popup.error', 'Hibás jelszó vagy hozzáférés megtagadva.'));
            }
          } catch (error) {
            console.error('[StaffTimer] Error transferring session:', error);
            console.error('[StaffTimer] Error code:', error.code);
            console.error('[StaffTimer] Error message:', error.message);
            console.error('[StaffTimer] Error details:', error.details);
            
            let errorMessage = getTranslation('pages.settings.staff.popup.error', 'Hibás jelszó vagy hozzáférés megtagadva.');
            
            if (error.code === 'unauthenticated') {
              errorMessage = 'Nincs bejelentkezve. Jelentkezz be újra!';
            } else if (error.code === 'permission-denied') {
              errorMessage = 'Hibás jelszó!';
            } else if (error.code === 'failed-precondition') {
              errorMessage = error.message || 'Nincs aktív munkamenet az átvitelhez.';
            }
            
            alert(errorMessage);
          }
        });
      }

      // Enter key handler
      if (input) {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && confirmBtn) {
            confirmBtn.click();
          }
        });
      }
    }, 50);
  }

  /**
   * Handle session replaced by another device
   */
  function handleSessionReplaced() {
    // Hide staff nav items
    if (window.staffNavItems && window.staffNavItems.hide) {
      window.staffNavItems.hide();
    }

    // Get translations
    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    const title = getTranslation('staff_timer.replaced_title', 'Munkamenet átvitele');
    const message = getTranslation('staff_timer.replaced_message', 'A munkameneted egy másik eszközre lett átvitele. Jelentkezz be újra a munkamenet folytatásához.');
    const buttonLabel = getTranslation('pages.settings.staff.button_login', 'Belépés');

    // Show warning notification with button
    if (window.showToastDirectly) {
      window.showToastDirectly(
        title,
        message,
        'warning',
        'info',
        buttonLabel,
        () => {
          // Open session transfer popup (if on settings page) or navigate to settings
          const currentPage = window.location.pathname.split('/').pop();
          if (currentPage === 'settings.html' && window.staffAccess && window.staffAccess.showSessionTransferPopup) {
            // Open popup directly
            window.staffAccess.showSessionTransferPopup();
          } else {
            // Navigate to settings.html#general and scroll to staff card
            window.location.href = 'settings.html#general';
            
            // Wait for page load, then open popup
            const checkAndOpen = () => {
              if (window.staffAccess && window.staffAccess.showSessionTransferPopup) {
                window.staffAccess.showSessionTransferPopup();
              } else {
                setTimeout(checkAndOpen, 100);
              }
            };
            setTimeout(checkAndOpen, 500);
          }
        }
      );
    }

    // Redirect to index ONLY if we're on dashboard.html or students.html
    const currentPage = window.location.pathname.split('/').pop();
    if (currentPage === 'dashboard.html' || currentPage === 'students.html') {
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 500);
    }
  }

  /**
   * Show notification that session was replaced (but still active)
   */
  function showSessionReplacedNotification() {
    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    const title = getTranslation('staff_timer.replaced_warning_title', 'Munkamenet átvitele');
    const message = getTranslation('staff_timer.replaced_warning_message', 'Valaki megpróbált egy munkafolyamatot indítani a neved alatt egy másik eszközön. A jelenlegi munkameneted továbbra is aktív, de le fog járni.');

    // Show warning notification
    if (window.showToastDirectly) {
      window.showToastDirectly(
        title,
        message,
        'warning',
        'info',
        null,
        null
      );
    }
  }

  /**
   * Handle session expired - hide nav items, show notification, redirect
   */
  function handleSessionExpired() {
    // Hide staff nav items
    if (window.staffNavItems && window.staffNavItems.hide) {
      window.staffNavItems.hide();
    }

    // Mark session as expired for index.html notification logic
    try {
      sessionStorage.setItem('eu2k_staff_session_expired', 'true');
    } catch (e) {
      console.warn('[StaffTimer] Could not set session expired flag in sessionStorage:', e);
    }

    // Get translations
    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };

    const title = getTranslation('staff_timer.expired_title', 'Munkamenet lejárt');
    const message = getTranslation('staff_timer.expired_description', 'A munkamenet lejárt. Kérlek jelentkezz be újra a beállításokban.');
    const buttonLabel = getTranslation('pages.settings.staff.button_login', 'Belépés');

    // Get current page once
    const currentPage = window.location.pathname.split('/').pop();
    
    const isIndexPage =
      currentPage === 'index.html' ||
      currentPage === '' ||
      window.location.pathname === '/' ||
      window.location.pathname.endsWith('/');

    // Show danger notification with button on index.html
    if (isIndexPage) {
      if (window.showToastDirectly) {
        window.showToastDirectly(
          title,
          message,
          'danger',
          'info',
          buttonLabel,
          () => {
            // Navigate to settings.html#general and scroll to staff card
            window.location.href = 'settings.html#general';
            
            // Wait for page load, then scroll to staff card
            const checkAndScroll = () => {
              const staffCard = document.getElementById('staffAccessCard');
              if (staffCard) {
                const scrollArea = document.querySelector('.main-scroll-area') || document.body;
                const cardTop = staffCard.getBoundingClientRect().top + scrollArea.scrollTop;
                const scrollPosition = cardTop - (window.innerHeight / 2) + (staffCard.offsetHeight / 2);
                scrollArea.scrollTo({
                  top: Math.max(0, scrollPosition),
                  behavior: 'smooth'
                });
              } else {
                // Retry if card not found yet
                setTimeout(checkAndScroll, 100);
              }
            };
            setTimeout(checkAndScroll, 500);
          }
        );
      }
    }

    // On ANY non-index page, redirect hard back to index for safety
    if (!isIndexPage) {
      console.log('[StaffTimer] Session expired on', currentPage, '- redirecting to index.html');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 500);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTimer);
  } else {
    initTimer();
  }

  // Check session periodically even if timer is not active
  // This ensures we always check the server-side session status
  setInterval(() => {
    checkAndStartTimer();
  }, 30000); // Check every 30 seconds

  // Export for global access
  window.staffTimer = {
    startTimer,
    stopTimer,
    isActive: () => sessionEndTime !== null,
    showTransferPopup: showTransferPopupGlobal
  };
  
  // Console commands for testing
  if (typeof window !== 'undefined') {
    window.testStaffSessionReplaced = () => {
      console.log('[StaffTimer] Testing session replaced notification...');
      handleSessionReplaced();
    };
    
    window.testStaffSessionReplacedWarning = () => {
      console.log('[StaffTimer] Testing session replaced warning notification...');
      showSessionReplacedNotification();
    };
    
    window.testStaffTransferPopup = () => {
      console.log('[StaffTimer] Testing transfer popup...');
      showTransferPopupGlobal('test_device_12345');
    };
  }
})();


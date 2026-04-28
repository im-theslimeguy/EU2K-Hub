/**
 * Developer Mode System
 * Provides password-protected developer mode with enhanced features
 */

(function() {
  'use strict';

  const DEV_MODE_KEY = 'eu2k-dev-mode';
  let devModeEnabled = false;
  let devModePillElement = null;
  let devModePopupAction = 'enable';

  /**
   * Check if developer mode is enabled
   */
  function isDevModeEnabled() {
    return devModeEnabled === true;
  }

  /**
   * Set developer mode state
   */
  function setDevMode(enabled) {
    try {
      devModeEnabled = !!enabled;
      localStorage.setItem(DEV_MODE_KEY, devModeEnabled ? 'true' : 'false');
      console.log(`[DevMode] Developer mode ${enabled ? 'enabled' : 'disabled'}`);
      updateDevModePillState();
      
      // Dispatch custom event for other scripts to listen to
      window.dispatchEvent(new CustomEvent('devModeChanged', { detail: { enabled: devModeEnabled } }));
    } catch (e) {
      console.error('[DevMode] Failed to save dev mode state:', e);
    }
  }

  function getTranslation(key, fallback) {
    try {
      return window.translationManager?.getTranslation(key) || fallback;
    } catch {
      return fallback;
    }
  }

  async function setDevModeStateInCloud(enabled, password) {
    const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js');
    if (!window.functions) {
      throw new Error('Firebase functions not initialized');
    }
    const setDevModeState = httpsCallable(window.functions, 'setDevModeState');
    const payload = { enabled: !!enabled };
    if (typeof password === 'string' && password.length > 0) {
      payload.password = password;
    }
    const response = await setDevModeState(payload);
    return response.data;
  }

  async function loadDevModeStateFromCloud() {
    try {
      const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js');
      if (!window.functions) return;
      const getDevModeState = httpsCallable(window.functions, 'getDevModeState');
      const response = await getDevModeState({});
      setDevMode(response?.data?.enabled === true);
    } catch (error) {
      console.warn('[DevMode] Could not load cloud dev mode state:', error?.message || error);
    }
  }

  function ensureDevModePillStyles() {
    if (document.getElementById('dev-mode-pill-style')) return;
    const style = document.createElement('style');
    style.id = 'dev-mode-pill-style';
    style.textContent = `
      .dev-mode-pill {
        display: none;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: var(--background-button-secondary);
        border: 1px solid var(--border-default-secondary);
        border-radius: 16px;
        padding: 6px 12px;
        width: fit-content;
        height: fit-content;
        min-height: 0;
        margin-right: 0;
        color: var(--text-button-secondary);
        font-size: 14px;
        font-weight: 600;
        z-index: 400;
        transition: all 0.2s ease;
        cursor: default;
        pointer-events: none;
      }
      .dev-mode-pill:hover {
        background: var(--background-button-secondary-hover);
        color: var(--text-default-quaternary);
      }
      .dev-mode-pill.active {
        display: flex;
      }
      .dev-mode-pill-icon {
        width: 16px;
        height: 16px;
        margin-bottom: 0;
        color: var(--icon-button-secondary);
      }
      .dev-mode-pill:hover .dev-mode-pill-icon {
        color: var(--icon-button-secondary);
      }
      .dev-mode-pill-label {
        color: inherit;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureDevModePill() {
    ensureDevModePillStyles();
    if (devModePillElement && document.getElementById('devModePill')) return devModePillElement;

    const accountButton = document.querySelector('#headerAccountBtn, .header-icon-btn[href*="account"]');
    const accountWrapper = accountButton ? accountButton.closest('.header-icon-wrapper') : null;
    const settingsWrapper = document.querySelector('#headerSettingsWrapper') ||
      document.querySelector('[id*="Settings"]') ||
      document.querySelector('.header-icon-wrapper[id*="settings"]') ||
      document.querySelector('.header-icon-wrapper');
    const gradientContainer = document.querySelector('.header-icon-gradient') || document.querySelector('.header-icon-container');
    const parent = (accountWrapper && accountWrapper.parentElement)
      ? accountWrapper.parentElement
      : ((settingsWrapper && settingsWrapper.parentElement) ? settingsWrapper.parentElement : gradientContainer);
    if (!parent) return null;

    const pillWrapper = document.createElement('div');
    pillWrapper.id = 'devModePillWrapper';
    pillWrapper.className = 'header-icon-wrapper';

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = 'devModePill';
    pill.className = 'dev-mode-pill';
    pill.innerHTML = `
      <img src="assets/global/dev.svg" class="permission-hand-icon dev-mode-pill-icon" alt="DEV">
      <span class="dev-mode-pill-label">DEV</span>
    `;
    pillWrapper.appendChild(pill);

    if (settingsWrapper && settingsWrapper.parentElement) {
      settingsWrapper.parentElement.insertBefore(pillWrapper, settingsWrapper);
    } else if (accountWrapper && accountWrapper.parentElement) {
      accountWrapper.parentElement.insertBefore(pillWrapper, accountWrapper);
    } else {
      parent.insertBefore(pillWrapper, parent.firstChild);
    }
    devModePillElement = pill;
    updateDevModePillState();
    return pill;
  }

  function updateDevModePillState() {
    const pill = ensureDevModePill();
    if (!pill) return;
    if (isDevModeEnabled()) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  }

  function syncDevModePopupContent() {
    const popup = document.getElementById('devModePopup');
    if (!popup) return;

    devModePopupAction = isDevModeEnabled() ? 'disable' : 'enable';
    const titleEl = popup.querySelector('.permission-title');
    const textEl = popup.querySelector('.permission-text');
    const buttonEl = popup.querySelector('.permission-ok-btn');

    const titleKey = devModePopupAction === 'disable' ? 'youhub.dev_mode.disable_title' : 'youhub.dev_mode.enable_title';
    const textKey = devModePopupAction === 'disable' ? 'youhub.dev_mode.disable_text' : 'youhub.dev_mode.enable_text';
    const buttonKey = devModePopupAction === 'disable' ? 'youhub.dev_mode.disable_button' : 'youhub.dev_mode.enable_button';

    const titleFallback = devModePopupAction === 'disable' ? 'Fejlesztői mód kikapcsolása' : 'Fejlesztői mód';
    const textFallback = devModePopupAction === 'disable'
      ? 'Add meg a jelszavad a fejlesztői mód kikapcsolásához.'
      : 'Add meg a jelszavad a fejlesztői mód bekapcsolásához.';
    const buttonFallback = devModePopupAction === 'disable' ? 'Kikapcsolás' : 'Bekapcsolás';

    if (titleEl) {
      titleEl.setAttribute('data-translate', titleKey);
      titleEl.setAttribute('data-translate-fallback', titleFallback);
      titleEl.textContent = getTranslation(titleKey, titleFallback);
    }

    if (textEl) {
      textEl.setAttribute('data-translate', textKey);
      textEl.setAttribute('data-translate-fallback', textFallback);
      textEl.textContent = getTranslation(textKey, textFallback);
      if (devModePopupAction === 'enable') {
        textEl.classList.add('dev-mode-help-anchor');
        textEl.setAttribute(
          'data-tooltip',
          getTranslation('youhub.dev_mode.password_hint', 'Azt a kódot add meg amit a munkamenet elindításához is használsz.')
        );
      } else {
        textEl.classList.remove('dev-mode-help-anchor');
        textEl.removeAttribute('data-tooltip');
      }
    }

    if (buttonEl) {
      buttonEl.setAttribute('data-translate', buttonKey);
      buttonEl.setAttribute('data-translate-fallback', buttonFallback);
      buttonEl.textContent = getTranslation(buttonKey, buttonFallback);
    }
  }

  /**
   * Show developer mode popup
   */
  function showDevModePopup() {
    const openPopup = () => {
      const popup = document.getElementById('devModePopup');
      
      if (!popup) {
        console.warn('[DevMode] Popup element not found');
        return;
      }

      // Apply inline styles for developer mode popup
      applyDevModeStyles();

      // Try to find scroll area (main-scroll-area or body)
      const scrollArea = document.querySelector('.main-scroll-area') || document.body;
      
      if (scrollArea) {
        // Keep popup in the same positioning context as staff popups.
        if (scrollArea.contains && !scrollArea.contains(popup)) {
          scrollArea.appendChild(popup);
        }
        scrollArea.scrollTop = 0;
        scrollArea.classList.add('no-scroll');
        scrollArea.classList.add('popup-active');
      }
      
      popup.style.display = 'flex';
      popup.classList.remove('dev-mode-loading');
      syncDevModePopupContent();
      
      const input = document.getElementById('devModePassword');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
      }
    };
    
    if (window.tryOpenPopup) {
      window.tryOpenPopup(openPopup);
    } else {
      openPopup();
    }
  }

  /**
   * Apply scoped dev-mode popup style overrides
   */
  function applyDevModeStyles() {
    const popup = document.getElementById('devModePopup');
    if (!popup) return;
    // Keep dev-mode popup visually in sync with permission popup styles.
    popup.classList.add('dev-mode-popup');

    if (!document.getElementById('dev-mode-popup-style-overrides')) {
      const style = document.createElement('style');
      style.id = 'dev-mode-popup-style-overrides';
      style.textContent = `
        #devModePopup.permission-overlay-scroll-area {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          background-color: #0B0F0BA6;
          z-index: 4000;
        }

        #devModePopup .permission-container {
          background: var(--icon-button-secondary);
        }

        #devModePopup .permission-title {
          color: var(--text-default-teritary);
        }

        #devModePopup .permission-text {
          color: var(--text-default-quaternary);
        }

        #devModePopup .dev-mode-help-anchor {
          cursor: help;
          position: relative;
        }

        #devModePopup .dev-mode-help-anchor::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 0;
          top: calc(100% + 10px);
          z-index: 1300;
          max-width: 340px;
          padding: 12px 16px;
          border-radius: 18px;
          background: var(--icon-button-secondary);
          border: 1px solid var(--border-default-secondary);
          color: var(--text-default-teritary);
          font-size: 14px;
          line-height: 1.35;
          font-weight: 500;
          box-shadow: 0 12px 24px #00000059;
          pointer-events: none;
          white-space: normal;
          opacity: 0;
          visibility: hidden;
          transform: translateY(-4px);
          transition: opacity 0.15s ease, visibility 0.15s ease, transform 0.15s ease;
        }

        #devModePopup .dev-mode-help-anchor:hover::after {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }

        #devModePopup .permission-content {
          gap: 0;
        }

        #devModePopup .dev-mode-popup-icon {
          width: 48px;
          height: 48px;
          margin-bottom: 16px;
          color: var(--icon-default-brand-2);
        }

        #devModePopup .dev-mode-input {
          width: 100%;
          padding: 12px 16px;
          background: var(--background-default-primary-2-hover);
          border: 1px solid var(--border-default-secondary);
          border-radius: 12px;
          color: var(--text-default-default);
          font-size: 14px;
          font-family: inherit;
          margin-bottom: 16px;
          box-sizing: border-box;
          transition: all 0.2s ease;
        }

        #devModePopup .dev-mode-input:focus {
          outline: none;
          border-color: var(--background-button-secondary);
          background: var(--icon-button-secondary);
        }

        #devModePopup .dev-mode-input::placeholder {
          color: var(--text-default-quaternary);
        }

        #devModePopup .dev-mode-loading-view {
          display: none;
          width: 100%;
          min-height: 124px;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
        }

        #devModePopup.dev-mode-loading .dev-mode-input,
        #devModePopup.dev-mode-loading .permission-ok-btn {
          display: none !important;
        }

        #devModePopup.dev-mode-loading .dev-mode-loading-view {
          display: flex;
        }

        #devModePopup .eu2k-loader {
          width: 80px;
          aspect-ratio: 1;
          border: 10px solid transparent;
          padding: 5px;
          box-sizing: border-box;
          background:
            radial-gradient(farthest-side,#fff 98%,transparent) 0 0/20px 20px no-repeat,
            conic-gradient(from 90deg at 10px 10px,transparent 90deg,#fff 0) content-box,
            conic-gradient(from -90deg at 40px 40px,transparent 90deg,#fff 0) content-box,
            #000;
          filter: blur(4px) contrast(10);
          animation: eu2k-l11 2s infinite;
          position: relative;
          z-index: 1;
          margin: 0 auto;
        }

        @keyframes eu2k-l11 {
          0%   { background-position: 0 0; }
          25%  { background-position: 100% 0; }
          50%  { background-position: 100% 100%; }
          75%  { background-position: 0% 100%; }
          100% { background-position: 0% 0; }
        }

        #devModePopup .permission-close-btn {
          border-color: var(--border-default-secondary);
          background: var(--background-button-secondary);
        }

        #devModePopup .permission-close-btn:hover {
          background: var(--background-button-secondary-hover);
        }

        #devModePopup .permission-close-btn img,
        #devModePopup .permission-close-btn .eu2k-inline-icon {
          width: 18px;
          height: 18px;
          color: var(--icon-button-secondary);
          transition: color 0.12s ease;
        }

        #devModePopup .permission-close-btn:hover img,
        #devModePopup .permission-close-btn:hover .eu2k-inline-icon {
          color: var(--text-default-teritary);
        }
      `;
      document.head.appendChild(style);
    }

    const content = popup.querySelector('.permission-content');
    if (content && !content.querySelector('.dev-mode-loading-view')) {
      content.insertAdjacentHTML(
        'beforeend',
        '<div class="dev-mode-loading-view" aria-live="polite"><div class="eu2k-loader"></div></div>'
      );
    }
  }

  function setDevModeLoading(isLoading) {
    const popup = document.getElementById('devModePopup');
    if (!popup) return;
    popup.classList.toggle('dev-mode-loading', isLoading);
  }

  /**
   * Close developer mode popup
   */
  function closeDevModePopup() {
    const popup = document.getElementById('devModePopup');
    const scrollArea = document.querySelector('.main-scroll-area') || document.body;
    
    if (popup) {
      popup.style.display = 'none';
    }
    
    if (scrollArea) {
      scrollArea.classList.remove('no-scroll');
      scrollArea.classList.remove('popup-active');
    }
  }

  /**
   * Check developer mode password using Firebase function
   */
  async function checkDevModePassword() {
    const input = document.getElementById('devModePassword');
    if (!input) {
      console.error('[DevMode] Password input not found');
      return;
    }
    
    const enteredPassword = input.value;
    console.log('[DevMode] Password entered:', enteredPassword ? '***' : '(empty)');
    console.log('[DevMode] Password length:', enteredPassword.length);
    
    if (!enteredPassword) {
      console.warn('[DevMode] Empty password entered');
      const msg = window.translationManager?.getTranslation('youhub.messages.wrong_password') || 'Kérjük, adjon meg jelszót!';
      if (window.showNotification) {
        await window.showNotification(msg, 'Hibás adatok', 'danger');
      } else {
        alert(msg);
      }
      return;
    }
    
    try {
      setDevModeLoading(true);
      // Use existing functions instance or create new one
      let functions;
      let verifyPassword;
      
      if (window.functions) {
        // Use existing functions instance
        console.log('[DevMode] Using existing window.functions');
        const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js');
        verifyPassword = httpsCallable(window.functions, 'verifyAdminConsolePassword');
      } else if (window.createHttpsCallable) {
        // Use existing createHttpsCallable helper
        console.log('[DevMode] Using window.createHttpsCallable');
        verifyPassword = window.createHttpsCallable('verifyAdminConsolePassword');
      } else {
        // Import and create new functions instance
        console.log('[DevMode] Creating new functions instance');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js');
        const app = window.firebaseApp || (await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js')).getApp();
        functions = getFunctions(app, 'europe-west1');
        verifyPassword = httpsCallable(functions, 'verifyAdminConsolePassword');
      }
      
      console.log('[DevMode] Calling verifyAdminConsolePassword function...');
      console.log('[DevMode] Function callable created:', !!verifyPassword);
      
      const targetEnabled = devModePopupAction !== 'disable';
      const result = await verifyPassword({ password: enteredPassword });
      console.log('[DevMode] Function call completed');
      console.log('[DevMode] Function result:', result);
      console.log('[DevMode] Function result.data:', result.data);
      
      if (result && result.data && result.data.success) {
        // Password verified successfully
        console.log('[DevMode] Password verified successfully');
        await setDevModeStateInCloud(targetEnabled, enteredPassword);
        setDevMode(targetEnabled);
        closeDevModePopup();
        
        // Trigger YouHub notifications view update if available
        if (typeof window.updateNotificationsView === 'function') {
          window.updateNotificationsView();
        }
        
        // Show success notification if available
        if (window.showNotification) {
          const msg = window.translationManager?.getTranslation(targetEnabled ? 'youhub.messages.dev_mode_enabled' : 'youhub.messages.dev_mode_disabled')
            || (targetEnabled ? 'Fejlesztői mód bekapcsolva!' : 'Fejlesztői mód kikapcsolva!');
          await window.showNotification(msg, 'Developer Mód', 'success');
        }
        
        console.log('[DevMode] Developer mode enabled');
      } else {
        // Wrong password
        const errorMsg = result?.data?.message || 'Hibás jelszó!';
        console.log('[DevMode] Password verification failed');
        console.log('[DevMode] Error message:', errorMsg);
        console.log('[DevMode] Full result:', result);
        
        const msg = window.translationManager?.getTranslation('youhub.messages.wrong_password') || errorMsg;
        
        if (window.showNotification) {
          await window.showNotification(msg, 'Hibás adatok', 'danger');
        } else {
          alert(msg);
        }
        
        input.value = '';
      }
    } catch (error) {
      console.error('[DevMode] Error verifying password:', error);
      console.error('[DevMode] Error type:', error.constructor.name);
      console.error('[DevMode] Error details:', {
        code: error.code,
        message: error.message,
        stack: error.stack,
        details: error.details
      });
      
      // Show error notification
      let errorMsg = 'Hiba történt a jelszó ellenőrzése során';
      if (error.message) {
        errorMsg = error.message;
      } else if (error.code) {
        errorMsg = `Hiba (${error.code}): ${error.message || 'Ismeretlen hiba'}`;
      }
      
      const msg = window.translationManager?.getTranslation('youhub.messages.wrong_password') || errorMsg;
      
      if (window.showNotification) {
        await window.showNotification(msg, 'Hiba', 'danger');
      } else {
        alert(msg);
      }
      
      input.value = '';
    } finally {
      setDevModeLoading(false);
    }
  }

  /**
   * Add Enter key support for password input
   */
  function initPasswordInput() {
    const input = document.getElementById('devModePassword');
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          checkDevModePassword();
        }
      });
    }
  }

  /**
   * Initialize keyboard shortcut (Alt+H)
   */
  function initKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      // Alt+H to open developer mode popup
      const isAltH = e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyH' || String(e.key).toLowerCase() === 'h');
      if (isAltH) {
        e.preventDefault();
        showDevModePopup();
      }
      
      // ESC to close popup
      if (e.key === 'Escape') {
        const popup = document.getElementById('devModePopup');
        if (popup && popup.style.display !== 'none') {
          closeDevModePopup();
        }
      }
    });
  }

  /**
   * Prevent header navigation when popup is open
   */
  function preventHeaderNavigation() {
    // Use event delegation to catch all header button clicks
    document.addEventListener('click', (e) => {
      const popup = document.getElementById('devModePopup');
      // If popup is open, prevent navigation from header buttons
      if (popup && popup.style.display !== 'none') {
        const target = e.target.closest('.header-icon-btn, .header-login-btn');
        if (target && (target.tagName === 'A' || target.closest('a'))) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    }, true); // Use capture phase to catch early
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initPasswordInput();
      initKeyboardShortcut();
      preventHeaderNavigation();
      ensureDevModePill();
      loadDevModeStateFromCloud();
    });
  } else {
    initPasswordInput();
    initKeyboardShortcut();
    preventHeaderNavigation();
    ensureDevModePill();
    loadDevModeStateFromCloud();
  }

  // Make functions globally available for onclick handlers and other scripts
  window.isDevModeEnabled = isDevModeEnabled;
  window.setDevMode = setDevMode;
  window.showDevModePopup = showDevModePopup;
  window.closeDevModePopup = closeDevModePopup;
  window.checkDevModePassword = checkDevModePassword;

  console.log('[DevMode] Developer mode system initialized');
  console.log('[DevMode] Press Alt+H to open developer mode');
})();


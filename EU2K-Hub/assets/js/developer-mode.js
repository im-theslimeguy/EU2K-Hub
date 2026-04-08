/**
 * Developer Mode System
 * Provides password-protected developer mode with enhanced features
 */

(function() {
  'use strict';

  const DEV_MODE_KEY = 'eu2k-dev-mode';

  /**
   * Check if developer mode is enabled
   */
  function isDevModeEnabled() {
    try {
      return localStorage.getItem(DEV_MODE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Set developer mode state
   */
  function setDevMode(enabled) {
    try {
      localStorage.setItem(DEV_MODE_KEY, enabled ? 'true' : 'false');
      console.log(`[DevMode] Developer mode ${enabled ? 'enabled' : 'disabled'}`);
      
      // Dispatch custom event for other scripts to listen to
      window.dispatchEvent(new CustomEvent('devModeChanged', { detail: { enabled } }));
    } catch (e) {
      console.error('[DevMode] Failed to save dev mode state:', e);
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
        scrollArea.scrollTop = 0;
        scrollArea.classList.add('no-scroll');
        scrollArea.classList.add('popup-active');
      }
      
      popup.style.display = 'flex';
      
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
   * Apply inline styles for developer mode popup elements
   */
  function applyDevModeStyles() {
    const popup = document.getElementById('devModePopup');
    if (!popup) return;

    // Permission overlay scroll area styles
    if (!popup.dataset.styled) {
      popup.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: #0B0F0BA6;
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        pointer-events: auto;
      `;
      popup.dataset.styled = 'true';
    }

    // Permission container styles
    const container = popup.querySelector('.permission-container');
    if (container && !container.dataset.styled) {
      container.style.cssText = `
        position: relative;
        background: #16210B;
        border-radius: 32px;
        padding: 32px;
        max-width: 420px;
        width: 100%;
        max-height: 100%;
        height: fit-content;
        overflow: hidden;
        box-sizing: border-box;
        pointer-events: auto;
      `;
      container.dataset.styled = 'true';
    }

    // Permission content styles
    const content = popup.querySelector('.permission-content');
    if (content && !content.dataset.styled) {
      content.style.cssText = `
        text-align: left;
        max-height: calc(100vh - 96px);
        height: fit-content;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: #445A2D #16210B;
        margin-right: -32px;
        padding-right: 32px;
        padding-bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      `;
      content.dataset.styled = 'true';
    }

    // Permission title styles
    const title = popup.querySelector('.permission-title');
    if (title && !title.dataset.styled) {
      title.style.cssText = `
        color: #C1EE8D;
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0 0 12px 0;
      `;
      title.dataset.styled = 'true';
    }

    // Permission text styles
    const text = popup.querySelector('.permission-text');
    if (text && !text.dataset.styled) {
      text.style.cssText = `
        color: #E5FDA9;
        text-align: left;
        margin: 0 0 18px 0;
        line-height: 1.6;
      `;
      text.dataset.styled = 'true';
    }

    // Dev mode input styles
    const input = document.getElementById('devModePassword');
    if (input && !input.dataset.styled) {
      input.style.cssText = `
        width: 100%;
        padding: 12px 16px;
        background: #273617;
        border: 1px solid var(--border-default-secondary);
        border-radius: 8px;
        color: #C1EE8D;
        font-size: 16px;
        margin-bottom: 16px;
        box-sizing: border-box;
      `;
      input.dataset.styled = 'true';
      
      // Focus state
      input.addEventListener('focus', function() {
        this.style.outline = 'none';
        this.style.borderColor = '#C1EE8D';
      });
      
      input.addEventListener('blur', function() {
        this.style.borderColor = 'var(--border-default-secondary)';
      });
    }

    // Permission OK button styles (if not already styled)
    const okBtn = document.querySelector('#devModePopup .permission-ok-btn');
    if (okBtn && !okBtn.dataset.styled) {
      okBtn.style.cssText = `
        min-width: 140px;
        height: 52px;
        background: var(--background-button-primary);
        border: 1px solid var(--border-default-primary);
        border-radius: 16px;
        color: var(--text-button-primary);
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: background .12s ease, color .12s ease, transform .12s ease;
        padding: 0 20px;
        white-space: nowrap;
        display: flex;
        align-items: center;
        justify-content: center;
        align-self: flex-start;
        position: relative;
        z-index: 1;
        box-sizing: border-box;
        overflow: visible;
        will-change: transform;
        backface-visibility: hidden;
        transform: translateZ(0);
        margin-bottom: 6px;
      `;
      okBtn.dataset.styled = 'true';
      
      // Hover state
      okBtn.addEventListener('mouseenter', function() {
        this.style.background = '#42587B';
        this.style.color = '#DBE8FF';
        this.style.transform = 'scaleY(1.12)';
        this.style.transformOrigin = 'center';
      });
      
      okBtn.addEventListener('mouseleave', function() {
        this.style.background = 'var(--background-button-primary)';
        this.style.color = 'var(--text-button-primary)';
        this.style.transform = 'scaleY(1)';
      });
      
      // Active state animation
      okBtn.addEventListener('mousedown', function() {
        this.style.animation = 'banner-btn-pop .16s cubic-bezier(.2,0,.2,1) forwards';
        setTimeout(() => {
          this.style.animation = '';
        }, 160);
      });
    }

    // Permission close button styles (if not already styled)
    const closeBtn = document.querySelector('#devModePopup .permission-close-btn');
    if (closeBtn && !closeBtn.dataset.styled) {
      closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        width: 52px;
        height: 52px;
        border-radius: 999px;
        background: var(--background-button-secondary);
        border: 1px solid #57703B;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: width .12s cubic-bezier(.2,.0,.2,1), border-radius .12s cubic-bezier(.2,.0,.2,1), background .12s ease;
        cursor: pointer;
        padding: 0;
      `;
      closeBtn.dataset.styled = 'true';
      
      // Close button image
      const closeImg = closeBtn.querySelector('img');
      if (closeImg) {
        closeImg.style.cssText = 'width: 18px; height: 18px; display: block;';
      }
      
      // Hover state
      closeBtn.addEventListener('mouseenter', function() {
        this.style.width = '68px';
        this.style.borderRadius = '16px';
        this.style.background = '#DEFFBA';
      });
      
      closeBtn.addEventListener('mouseleave', function() {
        this.style.width = '52px';
        this.style.borderRadius = '999px';
        this.style.background = 'var(--background-button-secondary)';
      });
    }

    // Add keyframes animation and scrollbar styles if not already present
    if (!document.getElementById('dev-mode-styles')) {
      const style = document.createElement('style');
      style.id = 'dev-mode-styles';
      style.textContent = `
        @keyframes banner-btn-pop {
          0%   { transform: scaleY(1.00); }
          70%  { transform: scaleY(1.32); }
          100% { transform: scaleY(1.25); }
        }
        #devModePopup .permission-content::-webkit-scrollbar {
          width: 8px;
        }
        #devModePopup .permission-content::-webkit-scrollbar-track {
          background: transparent;
        }
        #devModePopup .permission-content::-webkit-scrollbar-thumb {
          background: #445A2D;
          border-radius: 4px;
        }
      `;
      document.head.appendChild(style);
    }
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
      
      const result = await verifyPassword({ password: enteredPassword });
      console.log('[DevMode] Function call completed');
      console.log('[DevMode] Function result:', result);
      console.log('[DevMode] Function result.data:', result.data);
      
      if (result && result.data && result.data.success) {
        // Password verified successfully
        console.log('[DevMode] Password verified successfully');
        setDevMode(true);
        closeDevModePopup();
        
        // Trigger YouHub notifications view update if available
        if (typeof window.updateNotificationsView === 'function') {
          window.updateNotificationsView();
        }
        
        // Show success notification if available
        if (window.showNotification) {
          const msg = window.translationManager?.getTranslation('youhub.messages.dev_mode_enabled') || 'Developer mód bekapcsolva!';
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
      if (e.altKey && e.key === 'h') {
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
    });
  } else {
    initPasswordInput();
    initKeyboardShortcut();
    preventHeaderNavigation();
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


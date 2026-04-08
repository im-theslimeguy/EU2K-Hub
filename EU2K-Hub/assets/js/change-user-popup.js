// Change User Popup - Global Script
// This script handles the "Felhasználóváltás" button functionality across all popups

(function() {
  'use strict';

  // Open change user popup
  window.openChangeUserPopup = function(currentPopupId) {
    console.log('Opening change user popup, closing:', currentPopupId);
    
    // Close current popup
    if (currentPopupId) {
      const currentPopup = document.getElementById(currentPopupId);
      if (currentPopup) {
        currentPopup.style.display = 'none';
      }
    }

    // Close all auth popups
    const scanAuthPopup = document.getElementById('scanAuthPopup');
    const showQrPopup = document.getElementById('showQrPopup');
    const codeEntryPopup = document.getElementById('codeEntryPopup');
    
    if (scanAuthPopup) scanAuthPopup.style.display = 'none';
    if (showQrPopup) showQrPopup.style.display = 'none';
    if (codeEntryPopup) codeEntryPopup.style.display = 'none';

    // Open change user popup
    const changeUserPopup = document.getElementById('changeUserPopup');
    const scrollArea = document.querySelector('.main-scroll-area');

    if (changeUserPopup && scrollArea) {
      scrollArea.scrollTop = 0;
      scrollArea.classList.add('no-scroll');
      scrollArea.classList.add('popup-active');

      setTimeout(() => {
        changeUserPopup.style.display = 'flex';
      }, 50);
    }
  };

  // Close change user popup
  window.closeChangeUserPopup = function() {
    console.log('Closing change user popup');
    const popup = document.getElementById('changeUserPopup');
    const scrollArea = document.querySelector('.main-scroll-area');

    if (popup) popup.style.display = 'none';
    if (scrollArea) {
      scrollArea.classList.remove('no-scroll');
      scrollArea.classList.remove('popup-active');
    }
  };

  // Handle change user button click
  window.handleChangeUser = async function() {
    console.log('Change user button clicked');
    
    try {
      // Import Firebase Auth
      const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
      const auth = getAuth();
      
      // Sign out from Firebase
      await signOut(auth);
      console.log('✅ Signed out successfully');
      
      // Clear localStorage
      localStorage.removeItem('eu2k-auth-logged-in');
      localStorage.removeItem('eu2k-user-type');
      localStorage.removeItem('eu2k-auth-display-name');
      localStorage.removeItem('eu2k-auth-email');
      localStorage.removeItem('eu2k-auth-photo-url');
      
      // Close popup
      closeChangeUserPopup();
      
      // Redirect to onboarding page
      window.location.href = 'onboarding.html';
      
    } catch (error) {
      console.error('❌ Error signing out:', error);
      // Still try to redirect even if signOut fails
      closeChangeUserPopup();
      window.location.href = 'onboarding.html';
    }
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Attach click handlers to all "Felhasználóváltás" buttons
      attachChangeUserHandlers();
    });
  } else {
    attachChangeUserHandlers();
  }

  function attachChangeUserHandlers() {
    // Find all "Felhasználóváltás" buttons and attach handlers
    document.querySelectorAll('.header-login-btn[data-translate="pages.qr.scan_auth_switch"]').forEach(button => {
      if (!button.hasAttribute('data-change-user-handler')) {
        button.setAttribute('data-change-user-handler', 'true');
        button.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          // Find the parent popup
          let popup = this.closest('[id$="Popup"]');
          if (!popup) {
            // Try to find by common popup classes
            popup = this.closest('.scan-auth-popup-container')?.closest('[id$="Popup"]');
          }
          
          const popupId = popup ? popup.id : null;
          openChangeUserPopup(popupId);
        });
      }
    });
  }

  // Re-attach handlers when new buttons are added dynamically
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length) {
        attachChangeUserHandlers();
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Console commands for testing auth states
  // Usage: setScanAuthSuccess() or setScanAuthFailed()
  
  // Helper function to generate error code
  function generateErrorCode(popupType, isBug) {
    const popupTypeUpper = popupType === 'scan' ? 'SCANQR' : 
                          popupType === 'showQr' ? 'SHOWQR' : 
                          'CODEENTRY';
    const errorType = 'FORCEDCONSOLE';
    const bugFlag = isBug ? '1' : '0';
    return `ERR-${popupTypeUpper}-${errorType}--${bugFlag}`;
  }

  // Helper function to update user text and hide/show buttons
  function updateUserText(popupType, state, errorCode) {
    // Get translation function
    const getTranslation = (key, fallback) => {
      try {
        return window.translationManager?.getTranslation(key) || fallback;
      } catch {
        return fallback;
      }
    };
    
    const translations = {
      scan: {
        success: getTranslation('pages.qr.auth_success_text', 'Sikeresen igazoltad magad.'),
        failed: getTranslation('pages.qr.auth_failed_text', 'Az igazolás sikertelen volt.'),
        failedDesc: getTranslation('pages.qr.auth_failed_desc', 'Kérlek próbáld újra, vagy próbálj ki egy másik igazolási módszert. '),
        errorCodeLink: getTranslation('pages.qr.auth_error_code_link', 'Hibakód')
      },
      showQr: {
        success: getTranslation('pages.qr.auth_success_text', 'Sikeresen igazoltad magad.'),
        failed: getTranslation('pages.qr.auth_failed_text', 'Az igazolás sikertelen volt.'),
        failedDesc: getTranslation('pages.qr.auth_failed_desc', 'Kérlek próbáld újra, vagy próbálj ki egy másik igazolási módszert. '),
        errorCodeLink: getTranslation('pages.qr.auth_error_code_link', 'Hibakód')
      },
      codeEntry: {
        success: getTranslation('pages.qr.auth_success_text', 'Sikeresen igazoltad magad.'),
        failed: getTranslation('pages.qr.auth_failed_text', 'Az igazolás sikertelen volt.'),
        failedDesc: getTranslation('pages.qr.auth_failed_desc', 'Kérlek próbáld újra, vagy próbálj ki egy másik igazolási módszert. '),
        errorCodeLink: getTranslation('pages.qr.auth_error_code_link', 'Hibakód')
      }
    };

    let userTextElement;
    let buttonsElement;
    if (popupType === 'scan') {
      userTextElement = document.getElementById('scanAuthUserText');
      buttonsElement = document.querySelector('#scanAuthPopup .scan-auth-buttons');
    } else if (popupType === 'showQr') {
      userTextElement = document.getElementById('showQrUserText');
      buttonsElement = document.querySelector('#showQrPopup .scan-auth-buttons');
    } else if (popupType === 'codeEntry') {
      userTextElement = document.getElementById('codeEntryUserTextContainer');
      buttonsElement = document.querySelector('#codeEntryPopup .scan-auth-buttons');
    }
    
    if (userTextElement) {
      if (state === 'success') {
        userTextElement.innerHTML = `<span style="font-weight: 600;">${translations[popupType].success}</span>`;
        userTextElement.style.textAlign = 'center';
        // Store original state
        userTextElement.dataset.originalState = 'success';
      } else if (state === 'failed') {
        const failedText = translations[popupType].failed;
        const failedDesc = translations[popupType].failedDesc;
        const errorCodeText = errorCode || generateErrorCode(popupType, false);
        const errorCodeId = `errorCode-${popupType}`;
        
        userTextElement.innerHTML = `
          <span style="font-weight: 400;">${failedText}</span><br>
          <span id="${errorCodeId}-desc" style="color: var(--text-default-default); font-weight: 400;">
            ${failedDesc}
            <span id="${errorCodeId}-link" style="text-decoration: underline; cursor: pointer; color: var(--text-default-default);">${translations[popupType].errorCodeLink}</span>
          </span>
          <span id="${errorCodeId}-code" style="color: var(--text-default-default); font-weight: 400; display: none;">${errorCodeText}</span>
        `;
        userTextElement.style.textAlign = 'center';
        
        // Store original state and error code
        userTextElement.dataset.originalState = 'failed';
        userTextElement.dataset.errorCode = errorCodeText;
        
        // Add click handler for error code link
        setTimeout(() => {
          const errorLink = document.getElementById(`${errorCodeId}-link`);
          const errorDesc = document.getElementById(`${errorCodeId}-desc`);
          const errorCodeSpan = document.getElementById(`${errorCodeId}-code`);
          
          if (errorLink && errorDesc && errorCodeSpan) {
            // Ensure pointer events are enabled
            errorLink.style.pointerEvents = 'auto';
            errorLink.style.cursor = 'pointer';
            errorLink.style.userSelect = 'none';
            
            errorLink.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              console.log('Error code link clicked');
              if (errorDesc.style.display !== 'none') {
                // Show error code
                errorDesc.style.display = 'none';
                errorCodeSpan.style.display = 'inline';
                errorCodeSpan.style.cursor = 'pointer';
                errorCodeSpan.style.pointerEvents = 'auto';
              } else {
                // Show original text
                errorDesc.style.display = 'inline';
                errorCodeSpan.style.display = 'none';
              }
            });
            
            // Also add click handler to error code span for toggle back
            errorCodeSpan.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              console.log('Error code span clicked');
              errorDesc.style.display = 'inline';
              errorCodeSpan.style.display = 'none';
            });
          }
        }, 50);
      } else if (state === 'default') {
        // Reset to original - this will need to be handled by reloading or storing original content
        userTextElement.style.textAlign = '';
        // Note: Original content should be restored from stored value or page reload
      }
    }
    
    // Hide buttons for success/failed states
    if (buttonsElement) {
      if (state === 'success' || state === 'failed') {
        buttonsElement.style.display = 'none';
      } else {
        buttonsElement.style.display = 'flex';
      }
    }
  }

  // Set scan QR auth to success
  window.setScanAuthSuccess = function() {
    console.log('✅ Setting scan QR auth to SUCCESS');
    const scanner = document.getElementById('scanAuthQrScanner');
    const successState = document.getElementById('scanAuthSuccessState');
    const failedState = document.getElementById('scanAuthFailedState');
    
    if (scanner) scanner.style.display = 'none';
    if (failedState) failedState.style.display = 'none';
    if (successState) successState.style.display = 'flex';
    
    updateUserText('scan', 'success');
  };
  
  // Set scan QR auth to default (reset)
  window.setScanAuthDefault = function() {
    console.log('🔄 Setting scan QR auth to DEFAULT');
    const scanner = document.getElementById('scanAuthQrScanner');
    const successState = document.getElementById('scanAuthSuccessState');
    const failedState = document.getElementById('scanAuthFailedState');
    
    if (scanner) scanner.style.display = 'block';
    if (successState) successState.style.display = 'none';
    if (failedState) failedState.style.display = 'none';
    
    updateUserText('scan', 'default');
  };

  // Set scan QR auth to failed
  window.setScanAuthFailed = function(isBug = false) {
    console.log('❌ Setting scan QR auth to FAILED');
    const scanner = document.getElementById('scanAuthQrScanner');
    const successState = document.getElementById('scanAuthSuccessState');
    const failedState = document.getElementById('scanAuthFailedState');
    
    if (scanner) scanner.style.display = 'none';
    if (successState) successState.style.display = 'none';
    if (failedState) failedState.style.display = 'flex';
    
    const errorCode = generateErrorCode('scan', isBug);
    updateUserText('scan', 'failed', errorCode);
  };

  // Set show QR auth to success
  window.setShowQrAuthSuccess = function() {
    console.log('✅ Setting show QR auth to SUCCESS');
    const qrContainer = document.getElementById('showQrCodeContainer');
    const successState = document.getElementById('showQrSuccessState');
    const failedState = document.getElementById('showQrFailedState');
    
    if (qrContainer) qrContainer.style.display = 'none';
    if (failedState) failedState.style.display = 'none';
    if (successState) successState.style.display = 'flex';
    
    updateUserText('showQr', 'success');
  };
  
  // Set show QR auth to default (reset)
  window.setShowQrAuthDefault = function() {
    console.log('🔄 Setting show QR auth to DEFAULT');
    const qrContainer = document.getElementById('showQrCodeContainer');
    const successState = document.getElementById('showQrSuccessState');
    const failedState = document.getElementById('showQrFailedState');
    
    if (qrContainer) qrContainer.style.display = 'block';
    if (successState) successState.style.display = 'none';
    if (failedState) failedState.style.display = 'none';
    
    updateUserText('showQr', 'default');
  };

  // Set show QR auth to failed
  window.setShowQrAuthFailed = function(isBug = false) {
    console.log('❌ Setting show QR auth to FAILED');
    const qrContainer = document.getElementById('showQrCodeContainer');
    const successState = document.getElementById('showQrSuccessState');
    const failedState = document.getElementById('showQrFailedState');
    
    if (qrContainer) qrContainer.style.display = 'none';
    if (successState) successState.style.display = 'none';
    if (failedState) failedState.style.display = 'flex';
    
    const errorCode = generateErrorCode('showQr', isBug);
    updateUserText('showQr', 'failed', errorCode);
  };

  // Set code entry auth to success
  window.setCodeEntryAuthSuccess = function() {
    console.log('✅ Setting code entry auth to SUCCESS');
    const codeContainer = document.getElementById('codeEntryContainer');
    const successState = document.getElementById('codeEntrySuccessState');
    const failedState = document.getElementById('codeEntryFailedState');
    
    if (codeContainer) codeContainer.style.display = 'none';
    if (failedState) failedState.style.display = 'none';
    if (successState) successState.style.display = 'flex';
    
    updateUserText('codeEntry', 'success');
  };
  
  // Set code entry auth to default (reset)
  window.setCodeEntryAuthDefault = function() {
    console.log('🔄 Setting code entry auth to DEFAULT');
    const codeContainer = document.getElementById('codeEntryContainer');
    const successState = document.getElementById('codeEntrySuccessState');
    const failedState = document.getElementById('codeEntryFailedState');
    
    if (codeContainer) codeContainer.style.display = 'flex';
    if (successState) successState.style.display = 'none';
    if (failedState) failedState.style.display = 'none';
    
    updateUserText('codeEntry', 'default');
  };

  // Set code entry auth to failed
  window.setCodeEntryAuthFailed = function(isBug = false) {
    console.log('❌ Setting code entry auth to FAILED');
    const codeContainer = document.getElementById('codeEntryContainer');
    const successState = document.getElementById('codeEntrySuccessState');
    const failedState = document.getElementById('codeEntryFailedState');
    
    if (codeContainer) codeContainer.style.display = 'none';
    if (successState) successState.style.display = 'none';
    if (failedState) failedState.style.display = 'flex';
    
    const errorCode = generateErrorCode('codeEntry', isBug);
    updateUserText('codeEntry', 'failed', errorCode);
  };

  // Reset all auth states to default
  window.resetAuthStates = function() {
    console.log('🔄 Resetting all auth states to default');
    
    // Use the individual reset functions
    if (typeof setScanAuthDefault === 'function') setScanAuthDefault();
    if (typeof setShowQrAuthDefault === 'function') setShowQrAuthDefault();
    if (typeof setCodeEntryAuthDefault === 'function') setCodeEntryAuthDefault();
    
    console.log('Note: User texts may need to be reset manually or reload the page');
  };

  // Log available commands
  console.log('%c🔧 Auth State Test Commands:', 'color: var(--icon-default-brand-2); font-weight: bold; font-size: 14px;');
  console.log('%c  setScanAuthSuccess()', 'color: var(--background-button-primary);');
  console.log('%c  setScanAuthFailed()', 'color: var(--background-button-primary);');
  console.log('%c  setShowQrAuthSuccess()', 'color: var(--background-button-primary);');
  console.log('%c  setShowQrAuthFailed()', 'color: var(--background-button-primary);');
  console.log('%c  setCodeEntryAuthSuccess()', 'color: var(--background-button-primary);');
  console.log('%c  setCodeEntryAuthFailed()', 'color: var(--background-button-primary);');
  console.log('%c  resetAuthStates()', 'color: var(--background-button-primary);');

})();


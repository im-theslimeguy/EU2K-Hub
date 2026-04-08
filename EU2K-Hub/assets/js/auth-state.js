// Minimal shared auth state helper
// - Reads localStorage flags written by onboarding
// - Shows a large hover indicator near the account icon with the user's name
// - Checks terms acceptance and redirects if needed
(function () {
  function getDisplayName() {
    return localStorage.getItem('eu2k-auth-display-name') || '';
  }

  function isLoggedIn() {
    return localStorage.getItem('eu2k-auth-logged-in') === 'true';
  }

  function hasAcceptedTerms() {
    return localStorage.getItem('termsAccepted') === 'true';
  }

  function checkTermsAcceptance() {
    // COMMENTED OUT: Automatic redirect to onboarding disabled
    /*
    // Only check if user is logged in and not already on onboarding page
    if (isLoggedIn() && !hasAcceptedTerms()) {
      const currentPath = window.location.pathname || '';
      const isOnOnboardingPage = currentPath.includes('onboarding_student.html') || 
                                 currentPath.includes('onboarding_parent.html') ||
                                 currentPath.includes('onboarding_teacher.html');
      
      if (!isOnOnboardingPage) {
        console.log('⚠️ User has not accepted terms, redirecting to onboarding...');
        window.location.href = '/EU2K-Hub/welcome/onboarding_student.html#terms-setup';
        return false;
      }
    }
    */
    return true;
  }

  function ensureIndicator() {
    if (document.getElementById('auth-hover-indicator')) return null;

    const indicator = document.createElement('div');
    indicator.id = 'auth-hover-indicator';
    indicator.style.cssText = [
      'position: absolute',
      'top: 56px',
      'right: 0',
      'z-index: 1000',
      'display: none',
      'padding: 16px 20px',
      'background: #272B26',
      'border-radius: 20px',
      'box-shadow: 0 8px 24px #00000059',
      'color: #e3e3e3',
      'max-width: 360px',
      'border: 1px solid #FFFFFF0D'
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-size: 18px; font-weight: 600; margin-bottom: 6px; color:#fff;';
    title.textContent = 'Bejelentkezve';

    const text = document.createElement('div');
    text.id = 'auth-hover-indicator-text';
    text.style.cssText = 'font-size: 16px; color:#C2C3C2;';
    text.textContent = '';

    indicator.appendChild(title);
    indicator.appendChild(text);

    // Insert into header if possible, else body
    const header = document.querySelector('.header');
    (header || document.body).appendChild(indicator);
    return indicator;
  }

  function wireHover(target) {
    const indicator = ensureIndicator();
    if (!indicator) return;

    function show() {
      if (!isLoggedIn()) return;
      const name = getDisplayName();
      const text = document.getElementById('auth-hover-indicator-text');
      if (text) text.textContent = name ? `mint: ${name}` : 'mint: Ismeretlen felhasználó';
      indicator.style.display = 'block';
    }

    function hide() {
      indicator.style.display = 'none';
    }

    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    // Touch fallback
    target.addEventListener('click', function () {
      if (!isLoggedIn()) return;
      const visible = indicator.style.display === 'block';
      indicator.style.display = visible ? 'none' : 'block';
      setTimeout(() => { indicator.style.display = 'none'; }, 2000);
    });
  }

  function init() {
    // COMMENTED OUT: Check terms acceptance on page load - automatic redirect disabled
    // checkTermsAcceptance();
    
    // Prefer account icon in header
    const accountLink = document.querySelector('.header .header-icons a[href*="account"], .header .header-icons a');
    if (accountLink) {
      wireHover(accountLink);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose terms checking function for other scripts
  window.checkTermsAcceptance = checkTermsAcceptance;

  // Expose a helper that other scripts can call to show the login-failed transitional page
  window.showLoginFailedIfNotLoggedIn = function (opts = {}) {
    // opts: { redirectPath } optional override
    try {
      if (!isLoggedIn()) {
        const target = opts.redirectPath || '/EU2K-Hub/welcome/onboarding_student.html#login-failed';
        window.location.href = target;
      }
    } catch (e) {
      // ignore
    }
  };

  // Automatic fallback: if user is on an onboarding page and an auth flow was started
  // but after a timeout there's still no logged-in state, redirect to the login-failed page.
  // This is a minimal safety net for failed OAuth/redirect flows.
  document.addEventListener('DOMContentLoaded', function () {
    try {
      const path = window.location.pathname || '';
      const onboardingPaths = [
        '/EU2K-Hub/welcome/onboarding_student.html',
        '/EU2K-Hub/webos/eu2khub/welcome/onboarding_student.html',
        '/welcome/onboarding_student.html',
        '/webos/eu2khub/welcome/onboarding_student.html'
      ];
      const authInProgress = localStorage.getItem('eu2k-auth-in-progress') === 'true';

      if (onboardingPaths.includes(path) && authInProgress) {
        // Wait 12 seconds for the auth flow to complete; if not, send to login-failed page.
        setTimeout(function () {
          if (!isLoggedIn()) {
            // Clear the in-progress flag and redirect
            try { localStorage.removeItem('eu2k-auth-in-progress'); } catch (_) {}
            window.location.href = '/EU2K-Hub/welcome/onboarding_student.html#login-failed';
          }
        }, 12000);
      }
    } catch (err) { /* noop */ }
  });

})();

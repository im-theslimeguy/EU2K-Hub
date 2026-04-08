(function () {
  if (window.__eu2kOverlayBooted) return; // prevent double init across multiple includes
  window.__eu2kOverlayBooted = true;
  // Detect if we're on index.html or another page
  const isIndexPage = window.location.pathname.endsWith('/index.html') || 
                      window.location.pathname === '/' || 
                      window.location.pathname === '/EU2K-Hub/' ||
                      window.location.pathname.endsWith('/EU2K-Hub');
  
  const READY_LOG = isIndexPage ? 'Events loading completed successfully' : 'Translation system initialized successfully';
  // Also tolerate variant phrasing
  const READY_ALIASES = [READY_LOG, 'Translation system initialized', 'Translations initialized successfully'];
  let overlayEl = null;
  let mountEl = null;
  let mainContentEl = null;
  let cleanupHandler = null;

  function whenDomReady(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  }

  function ensureMainContent(cb) {
    const el = document.querySelector('.main-content');
    if (el) {
      cb(el);
      return;
    }
    const mo = new MutationObserver(() => {
      const target = document.querySelector('.main-content');
      if (target) {
        mo.disconnect();
        cb(target);
      }
    });
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  function copyVisualStyle(fromEl, toEl) {
    const cs = getComputedStyle(fromEl);
    toEl.style.background = cs.background;
    toEl.style.backgroundColor = cs.backgroundColor;
    toEl.style.borderRadius = cs.borderRadius;
    toEl.style.boxShadow = cs.boxShadow;
  }

  function positionOverlay() {
    if (!overlayEl) return;
    // Always cover full viewport
    overlayEl.style.position = 'fixed';
    overlayEl.style.left = '0px';
    overlayEl.style.top = '0px';
    overlayEl.style.width = '100vw';
    overlayEl.style.height = '100vh';
    overlayEl.style.zIndex = '9999';
  }

  function createOverlay(mainContent) {
    mainContentEl = mainContent;

    overlayEl = document.createElement('div');
    overlayEl.setAttribute('id', 'eu2k-page-overlay');
    overlayEl.style.zIndex = '9999';
    overlayEl.style.opacity = '1';
    overlayEl.style.transition = 'opacity 300ms ease-in-out';
    overlayEl.style.borderRadius = '32px';
    copyVisualStyle(mainContentEl, overlayEl);

    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.style.width = '100%';
    inner.style.height = '100%';
    inner.style.display = 'flex';
    inner.style.alignItems = 'center';
    inner.style.justifyContent = 'center';
    inner.style.backgroundColor = '#000000';

    // Mount for the flutter iframe
    mountEl = document.createElement('div');
    mountEl.style.position = 'relative';
    mountEl.style.width = '100%';
    mountEl.style.height = '100%';
    inner.appendChild(mountEl);

    overlayEl.appendChild(inner);
    document.body.appendChild(overlayEl);

    positionOverlay();
    window.addEventListener('resize', positionOverlay);
    window.addEventListener('scroll', positionOverlay, { passive: true });

    return overlayEl;
  }

  async function showFlutterIndicator() {
    console.log('showFlutterIndicator called');
    try {
      // Ensure dependencies loaded
      console.log('Ensuring dependencies...');
      await ensureDependencies();
      console.log('Dependencies loaded, attempting to show contained indicator...');
      // Prefer contained for background circle
      const handle = await window.insertLoadingIndicator('contained', { container: mountEl, fadeIn: true, fadeInDuration: 150 });
      console.log('EU2K Flutter indicator shown');
      // Protect against early hides from other scripts until READY_LOG
      installHideGuard();
      // Style the iframe itself to the requested background and to be large
      if (window.flutterHandler && window.flutterHandler.iframes) {
        const iframe = window.flutterHandler.iframes.get('contained');
        if (iframe) {
          iframe.style.backgroundColor = '#000000';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.opacity = '1';
          iframe.style.display = 'block';
          iframe.style.zIndex = '10000';
        }
      }
      cleanupHandler = handle;
    } catch (e) {
      console.log('Contained indicator failed, trying uncontained fallback:', e);
      // Fallback: try uncontained
      try {
          await ensureDependencies();
        const handle = await window.insertLoadingIndicator('uncontained', { container: mountEl, fadeIn: true, fadeInDuration: 150 });
          console.log('EU2K Flutter indicator shown');
        installHideGuard();
        if (window.flutterHandler && window.flutterHandler.iframes) {
          const iframe = window.flutterHandler.iframes.get('uncontained');
          if (iframe) {
            iframe.style.backgroundColor = '#000000';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.opacity = '1';
            iframe.style.display = 'block';
            iframe.style.zIndex = '10000';
          }
        }
        cleanupHandler = handle;
      } catch (fallbackError) {
        console.error('Both contained and uncontained indicators failed:', fallbackError);
      }
    }
  }

  function fadeOutAndRemove() {
    if (!overlayEl) return;
    overlayEl.style.opacity = '0';
    setTimeout(() => {
      if (cleanupHandler && cleanupHandler.hide) {
        try { cleanupHandler.hide({ fadeOut: true, fadeOutDuration: 150 }); } catch (_) {}
      }
      overlayEl.remove();
      overlayEl = null;
      mountEl = null;
    }, 320);
  }

  // Intercept console.log early
  const originalLog = window.console && window.console.log ? window.console.log.bind(console) : null;
  function interceptLogs() {
    if (!originalLog) return;
    console.log = function (...args) {
      try {
        // When indicator appears -> release deferred scripts
        for (const a of args) {
          if (typeof a === 'string' && a.includes('EU2K Flutter indicator shown')) {
            releaseDeferredScripts();
            break;
          }
        }
        for (const a of args) {
          if (typeof a === 'string' && READY_ALIASES.some(sig => a.includes(sig))) {
            // Várunk még, ameddig a fordítások nincsenek alkalmazva
            const checkAndHide = () => {
              if (window.__eu2kTranslationsApplied === true) {
                removeHideGuard();
                fadeOutAndRemove();
              } else {
                // Ha még nincs alkalmazva, várunk még
                setTimeout(checkAndHide, 100);
              }
            };
            checkAndHide();
            break;
          }
        }
      } catch (_) {}
      return originalLog(...args);
    };
  }

  // Guard against premature hides from other parts of the site
  let originalHideFn = null;
  function installHideGuard() {
    if (!window.flutterHandler) return;
    if (originalHideFn) return; // already installed
    originalHideFn = window.flutterHandler.hideLoadingIndicator?.bind(window.flutterHandler);
    if (!originalHideFn) return;
    window.__eu2kOverlayActive = true;
    window.__eu2kQueuedHides = [];
    window.flutterHandler.hideLoadingIndicator = function(type, opts) {
      if (window.__eu2kOverlayActive) {
        // queue and ignore until we allow
        window.__eu2kQueuedHides.push([type, opts]);
        return true;
      }
      return originalHideFn(type, opts);
    };
  }

  function removeHideGuard() {
    if (!originalHideFn || !window.flutterHandler) return;
    window.__eu2kOverlayActive = false;
    const queued = Array.isArray(window.__eu2kQueuedHides) ? window.__eu2kQueuedHides : [];
    window.__eu2kQueuedHides = [];
    window.flutterHandler.hideLoadingIndicator = originalHideFn;
    originalHideFn = null;
    // Now flush any queued hides (optional)
    queued.forEach(([t, o]) => {
      try { window.flutterHandler.hideLoadingIndicator(t, o); } catch (_) {}
    });
  }

  // Defer scripts below overlay until indicator is shown
  function collectDeferredScripts() {
    const placeholders = Array.from(document.querySelectorAll('script[data-wait-for-overlay="true"][data-src]'));
    return placeholders;
  }

  function releaseDeferredScripts() {
    const placeholders = collectDeferredScripts();
    for (const ph of placeholders) {
      const s = document.createElement('script');
      const src = ph.getAttribute('data-src');
      const dtype = ph.getAttribute('data-type');
      if (src) {
        s.src = src;
      }
      s.type = dtype || ph.type || 'text/javascript';
      if (!src) {
        s.textContent = ph.textContent || '';
      }
      // Copy non-data attributes
      for (const { name, value } of Array.from(ph.attributes)) {
        if (!name.startsWith('data-') && name !== 'type') {
          s.setAttribute(name, value);
        }
      }
      ph.replaceWith(s);
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureDependencies() {
    if (window.insertLoadingIndicator && window.flutterHandler) return;
    const base = window.location.pathname.includes('/EU2K-Hub/') ? '/EU2K-Hub/' : '/';
    if (!window.flutterHandler) {
      await loadScript(base + 'assets/js/flutter-handler.js');
    }
    if (!window.insertLoadingIndicator) {
      await loadScript(base + 'assets/js/flutter-loading-injector.js');
    }
  }

  async function ensureTranslationSystem() {
    // Ha még nincs betöltve a fordítási rendszer, betöltjük
    if (!window.translationManager) {
      const base = window.location.pathname.includes('/EU2K-Hub/') ? '/EU2K-Hub/' : '/';
      try {
        await loadScript(base + 'assets/js/translations.js');
        // Várunk, amíg a TranslationManager elérhető lesz
        let attempts = 0;
        while (!window.translationManager && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        if (window.translationManager && !window.translationManager.isInitialized) {
          const savedLanguage = localStorage.getItem('eu2k_language') || 'hu';
          await window.translationManager.init();
          if (window.translationManager.currentLanguage !== savedLanguage) {
            await window.translationManager.switchLanguage(savedLanguage);
          }
          // Frissítjük a szövegeket, amikor a fordítási rendszer betöltődött
          if (window.updateLoadingText) {
            setTimeout(() => {
              window.updateLoadingText();
            }, 50);
          }
        }
      } catch (e) {
        console.warn('[Loader] Failed to load translation system:', e);
      }
    } else if (!window.translationManager.isInitialized) {
      try {
        const savedLanguage = localStorage.getItem('eu2k_language') || 'hu';
        await window.translationManager.init();
        if (window.translationManager.currentLanguage !== savedLanguage) {
          await window.translationManager.switchLanguage(savedLanguage);
        }
        // Frissítjük a szövegeket, amikor a fordítási rendszer betöltődött
        if (window.updateLoadingText) {
          setTimeout(() => {
            window.updateLoadingText();
          }, 50);
        }
      } catch (e) {
        console.warn('[Loader] Failed to initialize translation system:', e);
      }
    } else {
      // Ha már inicializálva van, csak frissítjük a szövegeket
      if (window.updateLoadingText) {
        setTimeout(() => {
          window.updateLoadingText();
        }, 50);
      }
    }
  }

  // Boot
  // interceptLogs(); // no longer needed; we rely on window load event
  console.log('EU2K Page Overlay Loader initialized');
  // Start immediately: attach to bootstrap overlay mount if present
  (async function startEarly() {
    const bootstrapMount = document.getElementById('eu2k-overlay-mount');
    if (bootstrapMount) {
      mainContentEl = document.querySelector('.main-content') || document.body;
      overlayEl = document.getElementById('eu2k-page-overlay');
      mountEl = bootstrapMount;
      window.__eu2kOverlayMount = mountEl;
      // Ensure overlay is properly positioned and visible
      if (overlayEl && mainContentEl) {
        window.addEventListener('resize', positionOverlay);
        window.addEventListener('scroll', positionOverlay, { passive: true });
        positionOverlay();
        overlayEl.style.display = 'block';
        overlayEl.style.opacity = '1';
      }
      // Show loader indicator immediately
      setTimeout(() => {
        showVideoIndicator();
      }, 50);
      // Release any deferred scripts once the indicator is visible
      releaseDeferredScripts();
    } else {
      // Create overlay immediately, even before DOM is ready
      mainContentEl = document.body || document.documentElement;
      overlayEl = document.createElement('div');
      overlayEl.setAttribute('id', 'eu2k-page-overlay');
      overlayEl.style.zIndex = '9999';
      overlayEl.style.opacity = '1';
      overlayEl.style.transition = 'opacity 300ms ease-in-out';
      overlayEl.style.borderRadius = '32px';
      // Default visual style
      overlayEl.style.background = '#000000';
      overlayEl.style.backgroundColor = '#000000';

      const inner = document.createElement('div');
      inner.style.position = 'relative';
      inner.style.width = '100%';
      inner.style.height = '100%';
      inner.style.display = 'flex';
      inner.style.alignItems = 'center';
      inner.style.justifyContent = 'center';
      inner.style.backgroundColor = '#000000';

      mountEl = document.createElement('div');
      mountEl.setAttribute('id', 'eu2k-overlay-mount');
      window.__eu2kOverlayMount = mountEl;
      mountEl.style.position = 'relative';
      mountEl.style.width = '100%';
      mountEl.style.height = '100%';
      inner.appendChild(mountEl);

      overlayEl.appendChild(inner);
      (document.documentElement || document.body).appendChild(overlayEl);

      positionOverlay();
      window.addEventListener('resize', positionOverlay);
      window.addEventListener('scroll', positionOverlay, { passive: true });

      // Show loader indicator immediately
      setTimeout(() => {
        showVideoIndicator();
      }, 50);

      // After DOM is ready, copy main content visual style (if available)
      whenDomReady(() => {
        ensureMainContent((mc) => {
          mainContentEl = mc;
          copyVisualStyle(mainContentEl, overlayEl);
        });
      });
    }
    // Hide overlay when browser finishes loading (load event), wait for translations, then fade out
    window.addEventListener('load', () => {
      const checkAndHide = () => {
        // Várunk, ameddig a fordítások nincsenek alkalmazva
        if (window.__eu2kTranslationsApplied === true) {
          setTimeout(() => {
            fadeOutAndRemove();
          }, 500);
        } else {
          // Ha még nincs alkalmazva, várunk még
          setTimeout(checkAndHide, 100);
        }
      };
      checkAndHide();
    });
  })();
})();

async function ensureTranslationSystem() {
  // Ha még nincs betöltve a fordítási rendszer, betöltjük
  if (!window.translationManager) {
    const base = window.location.pathname.includes('/EU2K-Hub/') ? '/EU2K-Hub/' : '/';
    try {
      await loadScript(base + 'assets/js/translations.js');
      // Várunk, amíg a TranslationManager elérhető lesz
      let attempts = 0;
      while (!window.translationManager && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (window.translationManager && !window.translationManager.isInitialized) {
        const savedLanguage = localStorage.getItem('eu2k_language') || 'hu';
        await window.translationManager.init();
        if (window.translationManager.currentLanguage !== savedLanguage) {
          await window.translationManager.switchLanguage(savedLanguage);
        }
      }
    } catch (e) {
      console.warn('[Loader] Failed to load translation system:', e);
    }
  } else if (!window.translationManager.isInitialized) {
    try {
      const savedLanguage = localStorage.getItem('eu2k_language') || 'hu';
      await window.translationManager.init();
      if (window.translationManager.currentLanguage !== savedLanguage) {
        await window.translationManager.switchLanguage(savedLanguage);
      }
    } catch (e) {
      console.warn('[Loader] Failed to initialize translation system:', e);
    }
  }
}

function showVideoIndicator() {
  console.log('[Loader] showVideoIndicator called');
  const mountElRef = window.__eu2kOverlayMount || document.getElementById('eu2k-overlay-mount');
  if (!mountElRef) {
    console.warn('[Loader] Mount element not found, retrying...');
    // Próbáljuk meg újra később
    setTimeout(showVideoIndicator, 100);
    return;
  }

  console.log('[Loader] Mount element found, creating loader');
  mountElRef.style.display = 'flex';
  mountElRef.style.flexDirection = 'column';
  mountElRef.style.alignItems = 'center';
  mountElRef.style.justifyContent = 'center';
  mountElRef.style.width = '100%';
  mountElRef.style.height = '100%';
  mountElRef.style.backgroundColor = '#000000';
  
  // Biztosítjuk, hogy a fordítási rendszer betöltődött (aszinkron, nem blokkoljuk a loader megjelenítését)
  ensureTranslationSystem().then(() => {
    // Amikor a fordítási rendszer betöltődött, frissítjük a szövegeket
    if (window.updateLoadingText) {
      window.updateLoadingText();
    }
  });

  // CSS loader stílusok hozzáadása, ha még nincs
  if (!document.getElementById('eu2k-loader-styles')) {
    const style = document.createElement('style');
    style.id = 'eu2k-loader-styles';
    style.textContent = `
      .eu2k-loader {
        width: 80px;
        aspect-ratio: 1;
        border: 10px solid #0000;
        padding: 5px;
        box-sizing: border-box;
        background: 
          radial-gradient(farthest-side,#fff 98%,#0000 ) 0 0/20px 20px no-repeat,
          conic-gradient(from 90deg at 10px 10px,#0000 90deg,#fff 0) content-box,
          conic-gradient(from -90deg at 40px 40px,#0000 90deg,#fff 0) content-box,
          #000;
        filter: blur(4px) contrast(10);
        animation: eu2k-l11 2s infinite;
        position: relative;
        z-index: 1;
      }
      .eu2k-loader-text {
        color: #ffffff;
        font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        font-size: 14px;
        margin-top: 20px;
        text-align: center;
        white-space: nowrap;
      }
      @keyframes eu2k-l11 {
        0%   {background-position:0 0}
        25%  {background-position:100% 0}
        50%  {background-position:100% 100%}
        75%  {background-position:0% 100%}
        100% {background-position:0% 0}
      }
    `;
    document.head.appendChild(style);
  }

  // Loader div létrehozása
  const loader = document.createElement('div');
  loader.className = 'eu2k-loader';

  // Szöveg elem létrehozása
  const loaderText = document.createElement('div');
  loaderText.className = 'eu2k-loader-text';
  loaderText.id = 'eu2k-loader-text';
  
  // Betöltési állapot követése
  let loadingStep = 0;
  
  // Helper függvény a fordítások lekéréséhez
  function getLoadingTranslation(key, fallback) {
    // Ha a fordítási rendszer elérhető, használjuk
    if (window.translationManager && window.translationManager.getTranslation) {
      try {
        const translation = window.translationManager.getTranslation(key);
        if (translation && typeof translation === 'string' && translation !== key) {
          return translation;
        }
      } catch (e) {
        console.warn('[Loader] Translation error for key:', key, e);
      }
    }
    // Fallback a magyar szövegre
    return fallback;
  }
  
  const loadingSteps = [
    { key: 'pages.loading.loading_page', fallback: 'Oldal betöltése...', condition: () => document.readyState === 'loading' },
    { key: 'pages.loading.loading_scripts', fallback: 'Scriptek és stílusok betöltése...', condition: () => document.readyState === 'interactive' && (!window.translationManager || !window.translationManager.isInitialized) },
    { key: 'pages.loading.loading_themes', fallback: 'Témák betöltése...', condition: () => window.__eu2kThemeReady !== true },
    { key: 'pages.loading.loading_translation_system', fallback: 'Nyelvrendszer betöltése...', condition: () => document.readyState === 'interactive' && (!window.translationManager || !window.translationManager.isInitialized) },
    { key: 'pages.loading.applying_translations', fallback: 'Fordítások alkalmazása...', condition: () => window.translationManager && window.translationManager.isInitialized && !window.__eu2kTranslationsApplied },
    { key: 'pages.loading.final_initialization', fallback: 'Végső inicializálás...', condition: () => document.readyState === 'complete' && window.translationManager && window.translationManager.isInitialized && window.__eu2kTranslationsApplied }
  ];
  
  function updateLoadingText() {
    if (!loaderText) return;
    
    const readyState = document.readyState;
    
    // Ellenőrizzük a nyelvrendszer állapotát
    const translationReady = window.translationManager && window.translationManager.isInitialized;
    const translationsApplied = window.__eu2kTranslationsApplied === true;
    
    // Válasszuk ki a megfelelő lépést
    let currentStep = loadingSteps.find(step => step.condition()) || loadingSteps[loadingSteps.length - 1];
    
    // Ha a nyelvrendszer betöltődött, de még nincs alkalmazva, mutassuk azt
    if (translationReady && !translationsApplied) {
      currentStep = loadingSteps.find(step => step.key === 'pages.loading.applying_translations') || currentStep;
    }
    
    // Ha a fordítási rendszer betöltődött, de még a 'loading' állapotban vagyunk, 
    // akkor is frissítsük a szöveget, hogy leforduljon
    if (translationReady && readyState === 'loading' && currentStep.key === 'pages.loading.loading_page') {
      // Ez az "oldal betöltése" lépés, frissítsük a fordítással
    }
    
    // Használjuk a fordítási rendszert, ha elérhető - mindig frissítjük
    const translatedText = getLoadingTranslation(currentStep.key, currentStep.fallback);
    
    if (loaderText.textContent !== translatedText) {
      loaderText.textContent = translatedText;
    }
  }
  
  // Kezdeti szöveg
  updateLoadingText();
  
  // Állapot változások követése
  document.addEventListener('readystatechange', updateLoadingText);
  
  // Scriptek betöltésének követése
  const observer = new MutationObserver(() => {
    updateLoadingText();
  });
  observer.observe(document.head, { childList: true, subtree: true });
  
  // Nyelvrendszer betöltésének követése - folytatjuk, amíg a fordítások nincsenek alkalmazva
  const checkTranslationStatus = setInterval(() => {
    updateLoadingText();
    // Csak akkor állítjuk le, ha minden kész
    if (window.translationManager && window.translationManager.isInitialized && window.__eu2kTranslationsApplied === true) {
      clearInterval(checkTranslationStatus);
    }
  }, 100);
  
  // Figyeljük a fordítási rendszer betöltését és alkalmazását - gyakrabban frissítjük
  const checkTranslationReady = setInterval(() => {
    if (window.translationManager && window.translationManager.isInitialized) {
      // Frissítjük a szövegeket, amikor a fordítási rendszer elérhető
      updateLoadingText();
      // Ha a fordítások alkalmazva lettek, frissítjük még egyszer és leállítjuk
      if (window.__eu2kTranslationsApplied === true) {
        updateLoadingText();
        clearInterval(checkTranslationReady);
      }
    }
  }, 50);
  
  // Amikor a fordítási rendszer betöltődik, azonnal frissítjük a szövegeket
  const checkTranslationManager = setInterval(() => {
    if (window.translationManager && window.translationManager.isInitialized && window.translationManager.translations) {
      // Frissítjük a szövegeket azonnal
      updateLoadingText();
      clearInterval(checkTranslationManager);
    }
  }, 100);
  
  // További ellenőrzés: amikor a fordítási rendszer betöltődik, frissítjük a szövegeket
  const originalApplyTranslations = window.translationManager?.applyTranslations;
  if (window.translationManager && originalApplyTranslations) {
    window.translationManager.applyTranslations = function() {
      const result = originalApplyTranslations.call(this);
      // Frissítjük a loading szövegeket is
      setTimeout(() => {
        if (window.updateLoadingText) {
          window.updateLoadingText();
        }
      }, 50);
      return result;
    };
  }
  
  // Globális elérhetőség, hogy a ensureTranslationSystem hívhatja
  window.updateLoadingText = updateLoadingText;

  mountElRef.innerHTML = '';
  mountElRef.appendChild(loader);
  mountElRef.appendChild(loaderText);
  console.log('[Loader] Loader element created and added to DOM');
  
  // Force reflow to ensure styles are applied
  void loader.offsetHeight;
}
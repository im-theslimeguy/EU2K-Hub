(function () {
  function waitForFlutterHandler() {
    return new Promise((resolve) => {
      if (window.flutterHandler) return resolve();
      const iv = setInterval(() => {
        if (window.flutterHandler) {
          clearInterval(iv);
          resolve();
        }
      }, 50);
    });
  }

  async function ensurePreloaded() {
    await waitForFlutterHandler();
    try {
      if (window.flutterHandler && typeof window.flutterHandler.preloadAll === 'function') {
        await window.flutterHandler.preloadAll();
      }
    } catch (e) {
      console.warn('Preload error (ignored):', e);
    }
  }

  function createOverlayContainer() {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background-color: #101510',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 9999'
    ].join(';');

    const mount = document.createElement('div');
    mount.style.cssText = [
      'position: relative',
      'width: 100%',
      'height: 100%'
    ].join(';');

    const gradient = document.createElement('div');
    gradient.style.cssText = [
      'position: absolute',
      'left: 0',
      'right: 0',
      'top: calc(50% + 88px)',
      'height: 24px',
      'background: linear-gradient(to bottom, #101510 0%, #10151000 100%)',
      'pointer-events: none'
    ].join(';');

    overlay.appendChild(mount);
    overlay.appendChild(gradient);
    document.body.appendChild(overlay);

    return { container: mount, destroy: () => overlay.remove() };
  }

  async function insertLoadingIndicator(type, options = {}) {
    const { container = null, overlay = !container, fadeIn = true, fadeInDuration = 300 } = options;

    await ensurePreloaded();

    let targetContainer = container;
    let cleanup = null;

    if (!targetContainer && overlay) {
      const { container: c, destroy } = createOverlayContainer();
      targetContainer = c;
      cleanup = destroy;
    }

    if (!targetContainer) {
      throw new Error('No target container provided and overlay disabled.');
    }

    const shown = window.flutterHandler.showLoadingIndicator(type, targetContainer, { fadeIn, fadeInDuration });
    if (!shown) {
      if (cleanup) cleanup();
      throw new Error('Failed to show loading indicator: ' + type);
    }

    return {
      hide: (opts = {}) => window.flutterHandler.hideLoadingIndicator(type, opts),
      destroy: () => cleanup && cleanup(),
      container: targetContainer
    };
  }

  // Console helpers for the homepage (#indicatorContainer)
  window.eu2kShowContained = async function () {
    const container = document.getElementById('indicatorContainer');
    return insertLoadingIndicator('contained', { container });
  };

  window.eu2kShowUncontained = async function () {
    const container = document.getElementById('indicatorContainer');
    return insertLoadingIndicator('uncontained', { container });
  };

  window.eu2kHideLoading = function (type = 'contained', opts = { fadeOut: true, fadeOutDuration: 300 }) {
    if (window.flutterHandler) {
      return window.flutterHandler.hideLoadingIndicator(type, opts);
    }
    return false;
  };

  // Programmatic API
  window.insertLoadingIndicator = insertLoadingIndicator;
})();



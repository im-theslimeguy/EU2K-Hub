(() => {
  const STORAGE_KEY = 'eu2k_theme';
  const DEFAULT_THEME = 'nature';
  const THEMES = ['nature', 'desert', 'love'];
  const THEME_LINK_ID = 'eu2k-theme-stylesheet';

  // TODO: extend to light themes (6 variants total).
  function getThemeFromStorage() {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase().trim();
    return THEMES.includes(raw) ? raw : DEFAULT_THEME;
  }

  function getThemeHref(themeCode) {
    return `theme/dark/${themeCode}.css`;
  }

  function ensureThemeLink() {
    let link = document.getElementById(THEME_LINK_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = THEME_LINK_ID;
      link.rel = 'stylesheet';
      link.href = getThemeHref(DEFAULT_THEME);
      document.head.appendChild(link);
    }
    return link;
  }

  function applyTheme(themeCode) {
    const code = THEMES.includes(themeCode) ? themeCode : DEFAULT_THEME;
    const link = ensureThemeLink();
    const targetHref = getThemeHref(code);

    return new Promise((resolve) => {
      if (link.getAttribute('href') === targetHref) {
        window.__eu2kThemeReady = true;
        window.__eu2kCurrentTheme = code;
        resolve(code);
        return;
      }

      window.__eu2kThemeReady = false;
      link.onload = () => {
        window.__eu2kThemeReady = true;
        window.__eu2kCurrentTheme = code;
        resolve(code);
      };
      link.onerror = () => {
        window.__eu2kThemeReady = true;
        window.__eu2kCurrentTheme = code;
        resolve(code);
      };
      link.setAttribute('href', targetHref);
    });
  }

  function setTheme(themeCode) {
    const code = THEMES.includes(themeCode) ? themeCode : DEFAULT_THEME;
    localStorage.setItem(STORAGE_KEY, code);
    return applyTheme(code);
  }

  async function initTheme() {
    const code = getThemeFromStorage();
    await applyTheme(code);
  }

  window.EU2KTheme = {
    THEMES,
    DEFAULT_THEME,
    getTheme: getThemeFromStorage,
    setTheme,
    applyTheme,
    initTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme, { once: true });
  } else {
    initTheme();
  }
})();

(() => {
  const STORAGE_KEY = 'eu2k_theme';
  const MODE_STORAGE_KEY = 'eu2k_tmode';
  const DEFAULT_THEME = 'nature';
  const DEFAULT_MODE = 'dark';
  const THEMES = ['nature', 'desert', 'love'];
  const MODES = ['dark', 'light'];
  const THEME_LINK_ID = 'eu2k-theme-stylesheet';

  function getThemeFromStorage() {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase().trim();
    return THEMES.includes(raw) ? raw : DEFAULT_THEME;
  }

  function getModeFromStorage() {
    const raw = (localStorage.getItem(MODE_STORAGE_KEY) || '').toLowerCase().trim();
    return MODES.includes(raw) ? raw : DEFAULT_MODE;
  }

  function getThemeHref(themeCode, modeCode) {
    const theme = THEMES.includes(themeCode) ? themeCode : DEFAULT_THEME;
    const mode = MODES.includes(modeCode) ? modeCode : DEFAULT_MODE;
    return `theme/${mode}/${theme}.css`;
  }

  function ensureThemeLink() {
    let link = document.getElementById(THEME_LINK_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = THEME_LINK_ID;
      link.rel = 'stylesheet';
      link.href = getThemeHref(DEFAULT_THEME, DEFAULT_MODE);
      document.head.appendChild(link);
    }
    return link;
  }

  function applyTheme(themeCode, modeCode) {
    const code = THEMES.includes(themeCode) ? themeCode : DEFAULT_THEME;
    const mode = MODES.includes(modeCode) ? modeCode : getModeFromStorage();
    const link = ensureThemeLink();
    const targetHref = getThemeHref(code, mode);

    return new Promise((resolve) => {
      if (link.getAttribute('href') === targetHref) {
        window.__eu2kThemeReady = true;
        window.__eu2kCurrentTheme = code;
        window.__eu2kCurrentThemeMode = mode;
        resolve({ theme: code, mode });
        return;
      }

      window.__eu2kThemeReady = false;
      link.onload = () => {
        window.__eu2kThemeReady = true;
        window.__eu2kCurrentTheme = code;
        window.__eu2kCurrentThemeMode = mode;
        resolve({ theme: code, mode });
      };
      link.onerror = () => {
        window.__eu2kThemeReady = true;
        window.__eu2kCurrentTheme = code;
        window.__eu2kCurrentThemeMode = mode;
        resolve({ theme: code, mode });
      };
      link.setAttribute('href', targetHref);
    });
  }

  function setTheme(themeCode, modeCode) {
    const code = THEMES.includes(themeCode) ? themeCode : DEFAULT_THEME;
    const mode = MODES.includes(modeCode) ? modeCode : getModeFromStorage();
    localStorage.setItem(STORAGE_KEY, code);
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    return applyTheme(code, mode);
  }

  function setMode(modeCode) {
    const mode = MODES.includes(modeCode) ? modeCode : DEFAULT_MODE;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    return applyTheme(getThemeFromStorage(), mode);
  }

  async function initTheme() {
    const code = getThemeFromStorage();
    const mode = getModeFromStorage();
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    await applyTheme(code, mode);
  }

  window.EU2KTheme = {
    THEMES,
    MODES,
    DEFAULT_THEME,
    DEFAULT_MODE,
    getTheme: getThemeFromStorage,
    getMode: getModeFromStorage,
    setTheme,
    setMode,
    applyTheme,
    initTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme, { once: true });
  } else {
    initTheme();
  }
})();

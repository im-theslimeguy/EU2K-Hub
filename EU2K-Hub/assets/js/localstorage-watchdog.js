(() => {
  const REQUIRED = {
    eu2k_theme: ['nature', 'desert', 'love'],
    eu2k_tmode: ['dark', 'light'],
    eu2k_language: ['hu', 'en', 'de', 'es', 'fr', 'zh', 'ja', 'sv', 'ru']
  };
  const DEFAULTS = { eu2k_theme: 'nature', eu2k_tmode: 'dark', eu2k_language: 'hu' };
  const OVERLAY_ID = 'eu2kWatchdogOverlay';
  let firestoreFns = null;
  let busy = false;

  function ensureOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#0B0F0BA6;z-index:2000;color:#fff;font-weight:600;';
    el.textContent = 'Beállítások helyreállítása...';
    document.body.appendChild(el);
    return el;
  }

  function isValid(key, val) {
    return REQUIRED[key]?.includes(String(val || '').toLowerCase());
  }

  function hasMissing() {
    return Object.keys(REQUIRED).some((k) => !isValid(k, localStorage.getItem(k)));
  }

  async function ensureFirestoreFns() {
    if (window.firestoreDoc && window.firestoreGetDoc && window.firestoreSetDoc) {
      return {
        doc: window.firestoreDoc,
        getDoc: window.firestoreGetDoc,
        setDoc: window.firestoreSetDoc
      };
    }
    if (firestoreFns) return firestoreFns;
    const mod = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
    firestoreFns = { doc: mod.doc, getDoc: mod.getDoc, setDoc: mod.setDoc };
    return firestoreFns;
  }

  async function restoreFromFirestore() {
    if (busy) return;
    if (!hasMissing()) return;
    busy = true;
    const overlay = ensureOverlay();
    overlay.style.display = 'flex';
    try {
      const uid = window.auth?.currentUser?.uid || localStorage.getItem('eu2k-auth-uid');
      if (!uid || !window.db) {
        Object.entries(DEFAULTS).forEach(([k, v]) => { if (!isValid(k, localStorage.getItem(k))) localStorage.setItem(k, v); });
        return;
      }
      const { doc, getDoc, setDoc } = await ensureFirestoreFns();
      const ref = doc(window.db, 'users', uid, 'settings', 'general');
      const snap = await getDoc(ref);
      const data = snap.exists() ? (snap.data() || {}) : {};
      const normalized = {
        eu2k_theme: isValid('eu2k_theme', data.colors) ? String(data.colors).toLowerCase() : DEFAULTS.eu2k_theme,
        eu2k_tmode: isValid('eu2k_tmode', data.theme) ? String(data.theme).toLowerCase() : DEFAULTS.eu2k_tmode,
        eu2k_language: isValid('eu2k_language', data.language) ? String(data.language).toLowerCase() : DEFAULTS.eu2k_language
      };
      Object.entries(normalized).forEach(([k, v]) => localStorage.setItem(k, v));
      await setDoc(ref, { colors: normalized.eu2k_theme, theme: normalized.eu2k_tmode, language: normalized.eu2k_language }, { merge: true });
      if (window.EU2KTheme?.applyTheme) {
        await window.EU2KTheme.applyTheme(normalized.eu2k_theme, normalized.eu2k_tmode);
      }
    } catch (e) {
      Object.entries(DEFAULTS).forEach(([k, v]) => { if (!isValid(k, localStorage.getItem(k))) localStorage.setItem(k, v); });
      console.warn('[Watchdog] Restore failed, defaults applied:', e);
    } finally {
      overlay.style.display = 'none';
      busy = false;
    }
  }

  setInterval(restoreFromFirestore, 5000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreFromFirestore, { once: true });
  } else {
    restoreFromFirestore();
  }
})();

(() => {
  const ROOT_ID = 'eu2kUniversalPopupRoot';

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'eu2k-universal-popup-overlay permission-overlay-scroll-area';
    root.innerHTML = `
      <div class="eu2k-universal-popup-container permission-container">
        <button type="button" class="eu2k-universal-popup-close permission-close-btn" data-role="close">
          <img src="assets/general/close.svg" alt="Bezárás">
        </button>
        <div class="eu2k-universal-popup-content permission-content">
          <img class="eu2k-universal-popup-icon permission-hand-icon" data-role="icon" alt="">
          <h2 class="eu2k-universal-popup-title permission-title" data-role="title"></h2>
          <p class="eu2k-universal-popup-text permission-text" data-role="text"></p>
          <button type="button" class="eu2k-universal-popup-ok permission-ok-btn" data-role="ok"></button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function showPopup(options = {}) {
    const {
      type = 'warning',
      iconSrc = 'assets/home/warning.svg',
      title = '',
      text = '',
      okText = 'Igen'
    } = options;

    const root = ensureRoot();
    const icon = root.querySelector('[data-role="icon"]');
    const titleEl = root.querySelector('[data-role="title"]');
    const textEl = root.querySelector('[data-role="text"]');
    const okBtn = root.querySelector('[data-role="ok"]');
    const closeBtn = root.querySelector('[data-role="close"]');

    if (icon) {
      icon.src = iconSrc;
      icon.alt = type || 'popup';
    }
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (okBtn) okBtn.textContent = okText;

    root.style.display = 'flex';
    document.body.classList.add('popup-active');

    return new Promise((resolve) => {
      const cleanup = () => {
        root.style.display = 'none';
        document.body.classList.remove('popup-active');
        okBtn?.removeEventListener('click', onConfirm);
        closeBtn?.removeEventListener('click', onCancel);
      };
      const onConfirm = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      okBtn?.addEventListener('click', onConfirm, { once: true });
      closeBtn?.addEventListener('click', onCancel, { once: true });
    });
  }

  window.EU2KUniversalPopup = { show: showPopup };
  window.showUniversalWarningPopup = (params = {}) => showPopup({ type: 'warning', ...params });
})();

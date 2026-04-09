(() => {
  const SELECTOR = [
    '.rail-icon img',
    '.header-icon-btn img:not(.account-expanded-avatar)',
    '.welcome-icon',
    '.header-edit-mode-icon',
    '.header-camera-indicator-icon',
    '.onboarding-header-icon',
    '.footer-social img',
    '.empty-state-icon',
    '.camera-blocked-icon',
    '.auth-popup-icon',
    '.auth-popup-card-icon',
    '.language-dropdown-icon',
    '.permission-hand-icon',
    '.qr-control-btn img',
    '.qr-scanner .corner',
    '#scanAuthQrScanner .corner',
    '.scan-auth-popup-icon',
    '.scan-auth-back-btn img',
    '.change-user-popup-icon',
    '.myclass-icon',
    '.notifications-icon',
    '.notifications-history-icon',
    '.calendar-icon',
    '.calendar-card-icon',
    '.calendar-empty-icon',
    '.students-empty-icon',
    '.suggestions-icon',
    '.suggestions-search-icon',
    '.suggestions-calendar-nav-item-img',
    '.notification-history-icon',
    '.myclass-nav-item img',
    '.myclass-arrow-btn img',
    '.calendar-detail-item img',
    '.hamburger-menu-item img',
    '.hamburger-menu-btn img',
    '#hamburgerApp img',
    '#hamburgerAccount img',
    '#hamburgerBack img',
    '.notifications-empty-icon',
    '.youhub-revert-icon',
    '.calendar-date-picker-icon',
    '.calendar-full-icon',
    '.calendar-more-btn img',
    '.date-picker-nav-btn img',
    '.suggestion-meta-icon img',
    '.info-banner-icon',
    '.warning-banner-icon',
    '.suggestions-global-actions img',
    '.suggestions-cta-icon--back',
    '.camera-blocked-overlay img',
    '.notification-detail-action-icon'
  ].join(', ');

  const cache = new Map();

  function isTintableImg(img) {
    const src = img.getAttribute('src') || '';
    if (!/\.svg(\?|#|$)/i.test(src)) return false;
    if (img.classList.contains('account-expanded-avatar')) return false;
    return true;
  }

  function absolutize(url) {
    try {
      return new URL(url, window.location.href).toString();
    } catch (_) {
      return url;
    }
  }

  function forceCurrentColor(svgEl) {
    const nodes = svgEl.querySelectorAll('[fill], [stroke], [style]');
    nodes.forEach((node) => {
      const fill = node.getAttribute('fill');
      const stroke = node.getAttribute('stroke');
      if (fill && fill.toLowerCase() !== 'none') node.setAttribute('fill', 'currentColor');
      if (stroke && stroke.toLowerCase() !== 'none') node.setAttribute('stroke', 'currentColor');
      const inlineStyle = node.getAttribute('style') || '';
      if (inlineStyle) {
        const next = inlineStyle
          .replace(/fill\s*:\s*(?!none\b)[^;]+;?/gi, 'fill: currentColor;')
          .replace(/stroke\s*:\s*(?!none\b)[^;]+;?/gi, 'stroke: currentColor;');
        node.setAttribute('style', next);
      }
    });
  }

  async function fetchSvgText(url) {
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    cache.set(url, p);
    return p;
  }

  async function convertImg(img) {
    if (!isTintableImg(img) || img.dataset.eu2kIconConverted === '1') return;
    const src = absolutize(img.getAttribute('src'));
    const text = await fetchSvgText(src);
    if (!text || !text.includes('<svg')) return;

    const tpl = document.createElement('template');
    tpl.innerHTML = text.trim();
    const svg = tpl.content.querySelector('svg');
    if (!svg) return;

    svg.classList.add(...img.classList);
    svg.classList.add('eu2k-inline-icon');
    svg.dataset.eu2kIconConverted = '1';

    const w = img.getAttribute('width');
    const h = img.getAttribute('height');
    if (w) svg.setAttribute('width', w);
    if (h) svg.setAttribute('height', h);
    const cs = getComputedStyle(img);
    svg.style.width = img.style.width || cs.width;
    svg.style.height = img.style.height || cs.height;
    svg.style.display = 'block';

    forceCurrentColor(svg);
    img.replaceWith(svg);
  }

  function scan(root = document) {
    root.querySelectorAll(SELECTOR).forEach((el) => {
      if (el.tagName === 'IMG') void convertImg(el);
    });
  }

  const mo = new MutationObserver((records) => {
    records.forEach((rec) => {
      rec.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches && node.matches(SELECTOR) && node.tagName === 'IMG') void convertImg(node);
        scan(node);
      });
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scan(document);
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }, { once: true });
  } else {
    scan(document);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

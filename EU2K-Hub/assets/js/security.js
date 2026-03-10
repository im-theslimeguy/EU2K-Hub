/**
 * Security Module – EU2K Hub
 * Globális biztonsági UI logika: Jelentés popup, fellebbezés stb.
 *
 * Konzolból hívható:
 *   openReportPopup()                              – megnyit üres popupot
 *   openReportPopup({ type: 'post', id: 'abc123' }) – célzott jelentés
 *   closeReportPopup()                             – bezárja a popupot
 */

(function () {
  'use strict';

  /* ── Base path detection ──────────────────────────────────────
     Meghatározza az assets/ prefix-et, hogy HTML-től függetlenül
     tudjuk az ikonokat és CSS-t betölteni.                       */
  var BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) {
      return s.src.replace(/assets\/js\/security\.js.*$/, '');
    }
    return '';
  }());

  /* ── CSS injection helpers ────────────────────────────────── */
  function injectCSS(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function injectScript(src, cb) {
    if (document.querySelector('script[src="' + src + '"]')) {
      if (cb) setTimeout(cb, 0);
      return;
    }
    var s = document.createElement('script');
    s.src = src;
    s.onload = cb || null;
    document.head.appendChild(s);
  }

  injectCSS(BASE + 'assets/css/security.css');
  injectCSS(BASE + 'assets/components/language-dropdown.css');

  /* ── State ────────────────────────────────────────────────── */
  var reasonDropdown = null;
  var isPenMode      = false;
  var reportTarget   = null; // { type, id, ... } – backend-hez kell majd

  /* ── Popup HTML ───────────────────────────────────────────── */
  function buildPopupHTML() {
    var reportSVG   = BASE + 'assets/general/utility/report.svg';
    var penLightSVG = BASE + 'assets/general/pen_light.svg';
    var penDarkSVG  = BASE + 'assets/general/pen_dark.svg';
    var closeSVG    = BASE + 'assets/general/close.svg';

    return (
      '<div id="security-report-overlay" class="sec-overlay" role="dialog"' +
      '  aria-modal="true" aria-label="Jelentés" style="display:none;">' +
      '  <div class="sec-popup">' +

      /* Close button (X) – top right, same style as permission popups */
      '    <button class="sec-close-btn" id="secCloseBtnReport"' +
      '      type="button" aria-label="Bezárás">' +
      '      <img src="' + closeSVG + '" alt="Bezárás">' +
      '    </button>' +

      /* ── Header: flag + title + description (Frame 2608771) ── */
      '    <div class="sec-header">' +
      '      <img class="sec-flag-icon" src="' + reportSVG + '" alt="" aria-hidden="true">' +
      '      <div class="sec-title-block">' +
      '        <h2 class="sec-popup-title">Jelentés</h2>' +
      '        <p class="sec-popup-desc">Ha láttál alaptalan, szabály vagy törvénysértő, jogsértő,' +
      '          vagy nem az iskolai házirendbe beleillő tartalmat, azt itt tudod jelenteni a DÖK-nek,' +
      '          vagy az Igazgatóságnak, aki majd a maradék dolgot intézi. A bejelentett személy vagy' +
      '          tartalom értesítve lesz (ha tartalom akkor a tartalom készítője), de nem fogja látni' +
      '          miért vagy ki jelentette fel.</p>' +
      '      </div>' +
      '    </div>' +

      /* ── Body: fields + actions (Frame 2608768) ── */
      '    <div class="sec-body">' +
      '      <div class="sec-fields">' +

      /* Frame 2608723 – "Miért jelentesz?" */
      '        <div class="sec-field-group">' +
      '          <div class="sec-field-header">' +
      '            <h3 class="sec-field-title">Miért jelentesz?</h3>' +
      '            <p class="sec-field-subtitle">' +
      '              Válassz egy okot vagy kattints a' +
      '              <img class="sec-inline-pen" src="' + penLightSVG + '" alt="" aria-hidden="true">' +
      '              ikonra egy speciális ok beírásához.' +
      '            </p>' +
      '          </div>' +
      /* Frame 2147236352 – dropdown + pen button row */
      '          <div class="sec-input-row">' +
      '            <div class="sec-dropdown-wrap" id="secReasonDropdownWrap"></div>' +
      '            <div class="sec-custom-input-wrap" id="secReasonCustomWrap" style="display:none;">' +
      '              <input class="sec-text-input" id="secReasonCustomInput" type="text"' +
      '                placeholder="Ide írj...">' +
      '            </div>' +
      '            <button class="sec-pen-btn" id="secPenBtn" type="button"' +
      '              aria-label="Egyéni ok beírása">' +
      '              <img src="' + penDarkSVG + '" id="secPenBtnIcon" alt="">' +
      '            </button>' +
      '          </div>' +
      '        </div>' +

      /* Frame 2608724 – "Jelentés" content input */
      '        <div class="sec-field-group">' +
      '          <div class="sec-field-header">' +
      '            <h3 class="sec-field-title">Jelentés</h3>' +
      '            <p class="sec-field-subtitle">' +
      '              Ide írd a jelenteni való tartalmat, ami szerinted megszegte a szabályainkat.' +
      '            </p>' +
      '          </div>' +
      '          <div class="sec-input-row">' +
      '            <input class="sec-text-input" id="secReportContentInput" type="text"' +
      '              placeholder="Ide írj...">' +
      '          </div>' +
      '        </div>' +

      '      </div>' + /* /.sec-fields */

      /* Frame 2608776 – action buttons */
      '      <div class="sec-actions">' +
      '        <button class="sec-action-btn sec-action-btn--blue" id="secSubmitBtn" type="button">' +
      '          Jelentés' +
      '        </button>' +
      '        <button class="sec-action-btn sec-action-btn--green" id="secSaveBtn" type="button">' +
      '          Jelentés mentése későbbre' +
      '        </button>' +
      '      </div>' +

      '    </div>' + /* /.sec-body */
      '  </div>' +   /* /.sec-popup */
      '</div>'        /* /.sec-overlay */
    );
  }

  /* ── DOM injection ────────────────────────────────────────── */
  function injectDOM() {
    if (document.getElementById('security-report-overlay')) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = buildPopupHTML();
    document.body.appendChild(tmp.firstElementChild);
    setupEvents();
  }

  /* ── Dropdown initialization ──────────────────────────────── */
  function initDropdown() {
    var dropWrap   = document.getElementById('secReasonDropdownWrap');
    var customWrap = document.getElementById('secReasonCustomWrap');
    if (!dropWrap) return;

    /* Reset visibility */
    dropWrap.style.display = '';
    if (customWrap) customWrap.style.display = 'none';

    /* Destroy previous instance */
    if (reasonDropdown) {
      try { reasonDropdown.destroy(); } catch (e) {}
      reasonDropdown = null;
    }
    dropWrap.innerHTML = '';

    /* LanguageDropdown needs a plain container div */
    var container = document.createElement('div');
    dropWrap.appendChild(container);

    if (typeof LanguageDropdown !== 'undefined') {
      /* A LanguageDropdown a .main-scroll-area magasságát számítja a menühöz.
         Popup esetén nincs ilyen, ezért max magasságot adunk data-attribútummal. */
      container.dataset.dropdownMaxHeight = '200';

      reasonDropdown = new LanguageDropdown(container, {
        options: [{ label: 'Válassz...', value: '' }],
        selectedIndex: 0,
        placeholder: 'Válassz...',
        onChange: function (value, index) {
          localStorage.setItem('eu2k_report_reason_idx', String(index));
          localStorage.setItem('eu2k_report_reason_val', String(value));
        }
      });
    } else {
      /* Fallback native select */
      var sel = document.createElement('select');
      sel.className = 'sec-text-input';
      sel.style.cursor = 'pointer';
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Válassz...';
      sel.appendChild(opt);
      container.appendChild(sel);
    }
  }

  /* ── Pen toggle ───────────────────────────────────────────── */
  function togglePenMode() {
    var dropWrap   = document.getElementById('secReasonDropdownWrap');
    var customWrap = document.getElementById('secReasonCustomWrap');
    var penIcon    = document.getElementById('secPenBtnIcon');
    var closeSVG   = BASE + 'assets/general/close.svg';
    var penDarkSVG = BASE + 'assets/general/pen_dark.svg';

    if (!isPenMode) {
      /* ── Dropdown → custom input ── */
      /* Save current dropdown selection to localStorage */
      var curIdx = reasonDropdown ? reasonDropdown.selectedIndex : 0;
      var curOpt = reasonDropdown && reasonDropdown.options
                    ? reasonDropdown.options[curIdx] : null;
      var curVal = curOpt
                    ? (typeof curOpt === 'object' ? (curOpt.value || '') : String(curOpt))
                    : '';
      localStorage.setItem('eu2k_report_reason_idx', String(curIdx));
      localStorage.setItem('eu2k_report_reason_val', curVal);

      /* Hide dropdown, show custom input */
      if (dropWrap)   dropWrap.style.display  = 'none';
      if (customWrap) customWrap.style.display = '';

      /* Swap icon: pen_dark → X (close) */
      if (penIcon) penIcon.src = closeSVG;
      isPenMode = true;

    } else {
      /* ── Custom input → dropdown ── */
      if (dropWrap)   dropWrap.style.display  = '';
      if (customWrap) customWrap.style.display = 'none';

      /* Restore saved selection */
      var savedIdx = parseInt(localStorage.getItem('eu2k_report_reason_idx') || '0', 10);
      if (reasonDropdown) {
        reasonDropdown.selectedIndex = isNaN(savedIdx) ? 0 : savedIdx;
        if (typeof reasonDropdown.updateDisplay === 'function') {
          reasonDropdown.updateDisplay();
        }
      }

      /* Swap icon: X → pen_dark */
      if (penIcon) penIcon.src = penDarkSVG;
      isPenMode = false;
    }
  }

  /* ── Open ─────────────────────────────────────────────────── */
  function openReportPopup(target) {
    reportTarget = target || null;
    isPenMode    = false;

    var overlay = document.getElementById('security-report-overlay');
    if (!overlay) {
      console.warn('[Security] Popup DOM not ready yet, retrying...');
      setTimeout(function () { openReportPopup(target); }, 100);
      return;
    }

    /* Reset inputs */
    var contentInput = document.getElementById('secReportContentInput');
    if (contentInput) contentInput.value = '';
    var customInput  = document.getElementById('secReasonCustomInput');
    if (customInput)  customInput.value  = '';

    /* Reset pen icon */
    var penIcon = document.getElementById('secPenBtnIcon');
    if (penIcon) penIcon.src = BASE + 'assets/general/pen_dark.svg';

    /* Re-init dropdown */
    initDropdown();

    /* Show overlay */
    overlay.style.display = 'flex';
    document.body.classList.add('popup-active');

    console.log('[Security] Report popup opened', reportTarget || '(no target)');
  }

  /* ── Close ────────────────────────────────────────────────── */
  function closeReportPopup() {
    var overlay = document.getElementById('security-report-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.classList.remove('popup-active');
    isPenMode = false;
    console.log('[Security] Report popup closed');
  }

  /* ── Event setup ──────────────────────────────────────────── */
  function setupEvents() {
    /* Close (X) button */
    var closeBtn = document.getElementById('secCloseBtnReport');
    if (closeBtn) closeBtn.addEventListener('click', closeReportPopup);

    /* Click on backdrop closes popup */
    var overlay = document.getElementById('security-report-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeReportPopup();
      });
    }

    /* Pen / X toggle */
    var penBtn = document.getElementById('secPenBtn');
    if (penBtn) penBtn.addEventListener('click', togglePenMode);

    /* Submit & Save: no backend yet */
    var submitBtn = document.getElementById('secSubmitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        console.log('[Security] Jelentés gomb megnyomva – backend összekötés hiányzik.');
      });
    }
    var saveBtn = document.getElementById('secSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        console.log('[Security] Mentés gomb megnyomva – backend összekötés hiányzik.');
      });
    }
  }

  /* ── Bootstrap ────────────────────────────────────────────── */
  function boot() {
    if (typeof LanguageDropdown === 'undefined') {
      injectScript(BASE + 'assets/components/language-dropdown.js', injectDOM);
    } else {
      injectDOM();
    }

    window.openReportPopup  = openReportPopup;
    window.closeReportPopup = closeReportPopup;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}());

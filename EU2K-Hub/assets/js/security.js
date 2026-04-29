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
  var currentPopupType = 'report';

  function getT(key, fallback) {
    try {
      return window.translationManager?.getTranslation(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function setFlagIconSource(nextSrc) {
    var oldIcon = document.querySelector('#security-report-overlay .sec-flag-icon');
    if (!oldIcon || !nextSrc) return;

    if (oldIcon.tagName && oldIcon.tagName.toLowerCase() === 'img') {
      oldIcon.src = nextSrc;
      return;
    }

    var replacement = document.createElement('img');
    replacement.className = 'sec-flag-icon';
    replacement.src = nextSrc;
    replacement.alt = '';
    replacement.setAttribute('aria-hidden', 'true');
    oldIcon.replaceWith(replacement);
  }

  function applyPopupVariant(target) {
    var kind = String(target?.type || 'content').toLowerCase();
    var isAppeal = kind === 'appeal';
    var isDecisionReport = kind === 'decision' || kind === 'decision_report';
    currentPopupType = isAppeal ? 'appeal' : 'report';

    var titleEl = document.querySelector('#security-report-overlay .sec-popup-title');
    var descEl = document.querySelector('#security-report-overlay .sec-popup-desc');
    var submitEl = document.getElementById('secSubmitBtn');
    var saveEl = document.getElementById('secSaveBtn');
    var flagEl = document.querySelector('#security-report-overlay .sec-flag-icon');
    var whyTitleEl = document.getElementById('secWhyTitle');
    var whySubTitleEl = document.getElementById('secWhySubtitle');
    var contentTitleEl = document.getElementById('secContentTitle');
    var contentSubTitleEl = document.getElementById('secContentSubtitle');
    var contentInputEl = document.getElementById('secReportContentInput');
    var reasonInputEl = document.getElementById('secReasonCustomInput');
    var dropWrap = document.getElementById('secReasonDropdownWrap');
    var customWrap = document.getElementById('secReasonCustomWrap');
    var penBtn = document.getElementById('secPenBtn');
    var emailWrap = document.getElementById('secAppealEmailWrap');
    var emailInput = document.getElementById('secAppealEmailInput');

    if (!titleEl || !descEl || !submitEl || !saveEl || !flagEl) return;

    var title = getT('security.report_popup.title', 'Jelentés');
    var desc = getT('security.report_popup.description', 'Ha láttál alaptalan, szabály vagy törvénysértő, jogsértő, vagy nem az iskolai házirendbe beleillő tartalmat, azt itt tudod jelenteni a DÖK-nek, vagy az Igazgatóságnak, aki majd a maradék dolgot intézi.');
    var submit = getT('security.report_popup.submit_button', 'Jelentés');
    var save = getT('security.report_popup.save_button', 'Jelentés mentése későbbre');
    var flagSrc = BASE + 'assets/general/utility/report.svg';

    if (isAppeal) {
      title = getT('security.appeal_popup.title', 'Fellebbezés');
      desc = getT('security.appeal_popup.description', 'Ha szerinted a döntés amit a képviselő hozott helytelen, itt fellebezhetsz. A fellebezésed a képviselő is látni fogja de nem ő fogja a döntést meghozni, a többi képvisleő véleményezheti, de a képviselőtanár fgja a végleges döntést meghozni. A döntésről az Értesítésközpontban értesülni fogsz 5-14 munkanapon belül. Ha nem teljesítjük a fellebezés átnézését vedd fel a kapcsolatot a képviselőtanárrral a Teamsen.');
      submit = getT('security.appeal_popup.submit_button', 'Fellebbezés');
      flagSrc = BASE + 'assets/general/utility/appeal.svg';
    } else if (isDecisionReport) {
      title = getT('security.report_decision_popup.title', 'Döntés jelentése');
      desc = getT('security.report_decision_popup.description', 'Itt tudod jelezni, ha egy döntéssel kapcsolatban szeretnél bejelentést tenni.');
      submit = getT('security.report_decision_popup.submit_button', 'Jelentés');
      save = getT('security.report_decision_popup.save_button', 'Jelentés mentése későbbre');
    }

    titleEl.textContent = title;
    descEl.textContent = desc;
    submitEl.textContent = submit;
    setFlagIconSource(flagSrc);

    if (isAppeal) {
      if (whyTitleEl) whyTitleEl.textContent = getT('security.appeal_popup.why_title', 'Miért lebezel fel?');
      if (whySubTitleEl) whySubTitleEl.textContent = getT('security.appeal_popup.why_subtitle', 'Ide a szerinted helytelen döntést, és a reklamációd írd. Nem kell bemutatkozni, azt látni fogjuk ki küldi be :)');
      if (reasonInputEl) reasonInputEl.placeholder = getT('security.appeal_popup.why_placeholder', 'Ide írj...');
      if (contentTitleEl) contentTitleEl.textContent = getT('security.appeal_popup.contact_email_title', 'Kapcsolattartási email');
      if (contentSubTitleEl) contentSubTitleEl.textContent = getT('security.appeal_popup.contact_email_subtitle', 'Csak akkor töltsd ki ha más embernek válaszoljunk. Csak @europa2000.hu domainre végződő email címeket fogadunk el.');
      if (dropWrap) dropWrap.style.display = 'none';
      if (customWrap) customWrap.style.display = '';
      if (penBtn) penBtn.style.display = 'none';
      if (contentInputEl) contentInputEl.style.display = 'none';
      if (emailWrap) emailWrap.style.display = '';
      if (emailInput) emailInput.placeholder = getT('security.appeal_popup.contact_email_placeholder', '...');
      saveEl.style.display = 'none';
      saveEl.setAttribute('aria-hidden', 'true');
    } else {
      if (whyTitleEl) whyTitleEl.textContent = getT('security.report_popup.why_title', 'Miért jelentesz?');
      if (whySubTitleEl) whySubTitleEl.textContent = getT('security.report_popup.why_subtitle', 'Válassz egy okot vagy kattints a toll ikonra egy speciális ok beírásához.');
      if (contentTitleEl) contentTitleEl.textContent = getT('security.report_popup.content_title', 'Jelentés');
      if (contentSubTitleEl) contentSubTitleEl.textContent = getT('security.report_popup.content_subtitle', 'Ide írd a jelenteni való tartalmat, ami szerinted megszegte a szabályainkat.');
      if (contentInputEl) {
        contentInputEl.style.display = '';
        contentInputEl.placeholder = getT('security.report_popup.content_placeholder', 'Ide írj...');
      }
      if (emailWrap) emailWrap.style.display = 'none';
      if (penBtn) penBtn.style.display = '';
      saveEl.style.display = '';
      saveEl.removeAttribute('aria-hidden');
      saveEl.textContent = save;
    }
  }

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
      '        <h2 class="sec-popup-title" data-translate="security.report_popup.title"' +
      '          data-translate-fallback="Jelentés">Jelentés</h2>' +
      '        <p class="sec-popup-desc" data-translate="security.report_popup.description"' +
      '          data-translate-fallback="Ha láttál alaptalan, szabály vagy törvénysértő, jogsértő, vagy nem az iskolai házirendbe beleillő tartalmat, azt itt tudod jelenteni a DÖK-nek, vagy az Igazgatóságnak, aki majd a maradék dolgot intézi. A bejelentett személy vagy tartalom értesítve lesz (ha tartalom akkor a tartalom készítője), de nem fogja látni miért vagy ki jelentette fel.">' +
      '          Ha láttál alaptalan, szabály vagy törvénysértő, jogsértő, vagy nem az iskolai házirendbe beleillő tartalmat, azt itt tudod jelenteni a DÖK-nek, vagy az Igazgatóságnak, aki majd a maradék dolgot intézi. A bejelentett személy vagy tartalom értesítve lesz (ha tartalom akkor a tartalom készítője), de nem fogja látni miért vagy ki jelentette fel.' +
      '        </p>' +
      '      </div>' +
      '    </div>' +

      /* ── Body: fields + actions (Frame 2608768) ── */
      '    <div class="sec-body">' +
      '      <div class="sec-fields">' +

      /* Frame 2608723 – "Miért jelentesz?" */
      '        <div class="sec-field-group">' +
      '          <div class="sec-field-header">' +
      '            <h3 class="sec-field-title" id="secWhyTitle" data-translate="security.report_popup.why_title"' +
      '              data-translate-fallback="Miért jelentesz?">Miért jelentesz?</h3>' +
      '            <p class="sec-field-subtitle" id="secWhySubtitle" data-translate="security.report_popup.why_subtitle"' +
      '              data-translate-fallback="Válassz egy okot vagy kattints a toll ikonra egy speciális ok beírásához.">' +
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
      '            <h3 class="sec-field-title" id="secContentTitle" data-translate="security.report_popup.content_title"' +
      '              data-translate-fallback="Jelentés">Jelentés</h3>' +
      '            <p class="sec-field-subtitle" id="secContentSubtitle" data-translate="security.report_popup.content_subtitle"' +
      '              data-translate-fallback="Ide írd a jelenteni való tartalmat, ami szerinted megszegte a szabályainkat.">' +
      '              Ide írd a jelenteni való tartalmat, ami szerinted megszegte a szabályainkat.' +
      '            </p>' +
      '          </div>' +
      '          <div class="sec-input-row">' +
      '            <input class="sec-text-input" id="secReportContentInput" type="text"' +
      '              data-translate-placeholder="security.report_popup.content_placeholder"' +
      '              placeholder="Ide írj...">' +
      '            <div class="sec-email-input-wrap" id="secAppealEmailWrap" style="display:none;">' +
      '              <input class="sec-email-input" id="secAppealEmailInput" type="text" placeholder="...">' +
      '              <span class="sec-email-suffix">@europa2000.hu</span>' +
      '            </div>' +
      '          </div>' +
      '        </div>' +

      '      </div>' + /* /.sec-fields */

      /* Frame 2608776 – action buttons */
      '      <div class="sec-actions">' +
      '        <button class="sec-action-btn sec-action-btn--blue" id="secSubmitBtn" type="button"' +
      '          data-translate="security.report_popup.submit_button"' +
      '          data-translate-fallback="Jelentés">' +
      '          Jelentés' +
      '        </button>' +
      '        <button class="sec-action-btn sec-action-btn--green" id="secSaveBtn" type="button"' +
      '          data-translate="security.report_popup.save_button"' +
      '          data-translate-fallback="Jelentés mentése későbbre">' +
      '          Jelentés mentése későbbre' +
      '        </button>' +
      '      </div>' +

      '    </div>' + /* /.sec-body */

      /* Betöltő overlay – a popup belsejébe kerül, köldés közben aktív */
      '    <div class="sec-loading-overlay" id="secLoadingOverlay">' +
      '      <div class="sec-loading-spinner"></div>' +
      '      <h3 class="sec-loading-title" data-translate="security.report_popup.loading_title"' +
      '        data-translate-fallback="Bejelentés beküldése...">Bejelentés beküldése...</h3>' +
      '      <p class="sec-loading-subtitle" data-translate="security.report_popup.loading_subtitle"' +
      '        data-translate-fallback="Kérjük ne zárd be ezt az oldalt!">Kérjük ne zárd be ezt az oldalt!</p>' +
      '    </div>' +

      '  </div>' +   /* /.sec-popup */
      '</div>'        /* /.sec-overlay */
    );
  }

  /* ── DOM injection ────────────────────────────────────────── */
  function injectDOM() {
    if (document.getElementById('security-report-overlay')) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = buildPopupHTML();
    var mount = document.querySelector('.main-scroll-area') || document.body;
    mount.appendChild(tmp.firstElementChild);
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

    /* A container kapja meg a language-dropdown osztályt, hogy position:relative
       legyen rajta. Enélkül a menu (position:absolute; top:100%) a popup aljára
       tolódik, mert a következő position:relative ős a .sec-popup lenne. */
    var container = document.createElement('div');
    container.className = 'language-dropdown';
    dropWrap.appendChild(container);

    // Report reason kategóriák – ID-k, amik a backendre is mennek
    var REASON_KEYS = [
      'harassment',
      'illegal_content',
      'spam',
      'ads',
      'false_info',
      'hate_speech',
      'bullying',
      'scam',
      'impersonation',
      'nsfw',
      'violence',
      'other'
    ];

    // Fordítás helper – security.report_reasons.* kulcsok
    function tReason(key, fallback) {
      try {
        if (window.translationManager && typeof window.translationManager.getTranslation === 'function') {
          var fullKey = 'security.report_reasons.' + key;
          var translated = window.translationManager.getTranslation(fullKey);
          if (translated && typeof translated === 'string') {
            return translated;
          }
        }
      } catch (e) {
        // ignore
      }
      return fallback;
    }

    // Alapértelmezett (hu) label-ek fallbacknek – hogy sose az ID látszódjon
    var REASON_FALLBACK_LABELS_HU = {
      placeholder: 'Válassz...',
      harassment: 'Zaklatás',
      illegal_content: 'Illegális tartalom',
      spam: 'Spam',
      ads: 'Hirdetés / reklám',
      false_info: 'Hamis információ',
      hate_speech: 'Gyűlöletbeszéd',
      bullying: 'Megfélemlítés / bullying',
      scam: 'Csalás / átverés',
      impersonation: 'Személyiséglopás / más nevében való fellépés',
      nsfw: '18+ tartalom (NSFW)',
      violence: 'Erőszakos tartalom',
      other: 'Egyéb'
    };

    var placeholderLabel = tReason('placeholder', REASON_FALLBACK_LABELS_HU.placeholder);

    // Teljes opció lista: placeholder + 11 kategória
    var options = [{
      label: placeholderLabel,
      value: ''
    }].concat(
      REASON_KEYS.map(function (key) {
        return {
          label: tReason(key, REASON_FALLBACK_LABELS_HU[key] || key),
          value: key
        };
      })
    );

    if (typeof LanguageDropdown !== 'undefined') {
      /* A LanguageDropdown a .main-scroll-area magasságát számítja a menühöz.
         Popup esetén nincs ilyen, ezért max magasságot adunk data-attribútummal. */
      container.dataset.dropdownMaxHeight = '240';

      reasonDropdown = new LanguageDropdown(container, {
        options: options,
        selectedIndex: 0,
        placeholder: placeholderLabel,
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

      options.forEach(function (optConf) {
        var opt = document.createElement('option');
        opt.value = optConf.value;
        opt.textContent = optConf.label;
        sel.appendChild(opt);
      });

      container.appendChild(sel);
    }
  }

  /* ── Pen toggle ───────────────────────────────────────────── */
  function togglePenMode() {
    if (currentPopupType === 'appeal') return;
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
    var appealEmailInput = document.getElementById('secAppealEmailInput');
    if (appealEmailInput) appealEmailInput.value = '';

    /* Reset pen icon */
    var penIcon = document.getElementById('secPenBtnIcon');
    if (penIcon) penIcon.src = BASE + 'assets/general/pen_dark.svg';

    /* Re-init dropdown only for report variants */
    var kind = String(target?.type || 'content').toLowerCase();
    if (kind !== 'appeal') {
      initDropdown();
    } else {
      var dropWrap = document.getElementById('secReasonDropdownWrap');
      var customWrap = document.getElementById('secReasonCustomWrap');
      if (dropWrap) dropWrap.style.display = 'none';
      if (customWrap) customWrap.style.display = '';
    }
    applyPopupVariant(target || { type: 'content' });

    var scrollArea = document.querySelector('.main-scroll-area');
    if (scrollArea) {
      scrollArea.classList.add('no-scroll');
      scrollArea.classList.add('popup-active');
    } else {
      document.body.classList.add('popup-active');
    }

    /* Show overlay */
    overlay.style.display = 'flex';

    console.log('[Security] Report popup opened', reportTarget || '(no target)');
  }

  /* ── Close ────────────────────────────────────────────────── */
  function closeReportPopup() {
    var overlay = document.getElementById('security-report-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    var scrollArea = document.querySelector('.main-scroll-area');
    if (scrollArea) {
      scrollArea.classList.remove('no-scroll');
      scrollArea.classList.remove('popup-active');
    } else {
      document.body.classList.remove('popup-active');
    }
    isPenMode = false;
    console.log('[Security] Report popup closed');
  }

  async function verifyAdminPassword(password) {
    var verifyPasswordFn;
    if (window.functions) {
      const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js');
      verifyPasswordFn = httpsCallable(window.functions, 'verifyAdminConsolePassword');
    } else if (window.createHttpsCallable) {
      verifyPasswordFn = window.createHttpsCallable('verifyAdminConsolePassword');
    } else {
      const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js');
      const app = window.firebaseApp || (await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js')).getApp();
      const functions = getFunctions(app, 'europe-west1');
      verifyPasswordFn = httpsCallable(functions, 'verifyAdminConsolePassword');
    }
    return verifyPasswordFn({ password: password });
  }

  function openManageMyClassVerifyPopup(options) {
    options = options || {};
    var onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
    var scrollArea = document.querySelector('.main-scroll-area') || document.body;
    if (!scrollArea) return;

    var old = document.getElementById('manageMyClassVerifyPopup');
    if (old) old.remove();

    scrollArea.scrollTo({ top: 0, behavior: 'instant' });
    scrollArea.classList.add('no-scroll');
    scrollArea.classList.add('popup-active');

    var popupHTML =
      '<div id="manageMyClassVerifyPopup" class="permission-overlay-scroll-area" style="display: none;">' +
      '  <div class="permission-container manage-myclass-access-container">' +
      '    <button class="permission-close-btn" id="manageMyClassVerifyCloseBtn">' +
      '      <img src="' + (BASE + 'assets/general/close.svg') + '" alt="Bezárás">' +
      '    </button>' +
      '    <div class="permission-content">' +
      '      <img src="' + (BASE + 'assets/qr-code/hand.svg') + '" class="permission-hand-icon" alt="Igazolás">' +
      '      <h2 class="permission-title">Igazold magad</h2>' +
      '      <p class="permission-text">Egy nagyobb hatású műveletet szeretnél végrehajtani, kérlek igazold magad.</p>' +
      '      <input type="password" id="manageMyClassVerifyPassword" class="dev-mode-input" placeholder="Jelszó">' +
      '      <button class="permission-ok-btn" id="manageMyClassVerifyConfirmBtn">Igazolás</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    scrollArea.insertAdjacentHTML('beforeend', popupHTML);

    setTimeout(function () {
      var popup = document.getElementById('manageMyClassVerifyPopup');
      var input = document.getElementById('manageMyClassVerifyPassword');
      var closeBtn = document.getElementById('manageMyClassVerifyCloseBtn');
      var confirmBtn = document.getElementById('manageMyClassVerifyConfirmBtn');
      if (popup) popup.style.display = 'flex';

      function closePopup() {
        scrollArea.classList.remove('no-scroll');
        scrollArea.classList.remove('popup-active');
        if (popup) popup.remove();
      }

      closeBtn && closeBtn.addEventListener('click', closePopup);
      popup && popup.addEventListener('click', function (e) {
        if (e.target === popup) closePopup();
      });

      confirmBtn && confirmBtn.addEventListener('click', async function () {
        if (!input) return;
        var password = String(input.value || '').trim();
        if (!password) {
          alert('Kérlek add meg a jelszót!');
          input.focus();
          return;
        }
        try {
          var result = await verifyAdminPassword(password);
          if (result && result.data && result.data.success) {
            closePopup();
            if (onSuccess) onSuccess();
          } else {
            alert('Hibás jelszó!');
          }
        } catch (e) {
          console.error('[Security] ManageMyClass verify error:', e);
          alert('Hiba történt az igazoláskor.');
        }
      });
    }, 0);
  }

  /* ── Report beküldés (Cloud Function) ────────────────────── */
  async function handleSubmitReport() {
    // Intentionally no-op for now; backend wiring comes later.
    return;
    /* 1. Beolvassuk a mezőket */
    var reason = '';
    var isCustomReason = isPenMode;

    if (isPenMode) {
      var customInput = document.getElementById('secReasonCustomInput');
      reason = customInput ? customInput.value.trim() : '';
    } else {
      if (reasonDropdown) {
        var opt = reasonDropdown.options && reasonDropdown.options[reasonDropdown.selectedIndex];
        reason = opt ? (typeof opt === 'object' ? (opt.value || '') : String(opt)) : '';
      }
    }

    var contentInput = document.getElementById('secReportContentInput');
    var content = contentInput ? contentInput.value.trim() : '';

    /* 2. Validálás */
    if (!reason) {
      if (window.showToastDirectly) {
        window.showToastDirectly(
          'Hiányos mezők',
          'Kérjük válassz vagy írj be egy okot a bejelentéshez!',
          'warning', 'warning'
        );
      }
      return;
    }

    /* 3. Betöltő overlay be */
    var loadingOverlay = document.getElementById('secLoadingOverlay');
    if (loadingOverlay) loadingOverlay.classList.add('active');

    try {
      /* 4. Firebase Functions betöltése és hívása */
      var { getFunctions, httpsCallable } = await import(
        'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js'
      );
      var functions   = getFunctions(window.firebaseApp, 'europe-west1');
      var submitFn    = httpsCallable(functions, 'submitReport');

      var payload = {
        reason:         reason,
        content:        content,
        isCustomReason: isCustomReason
      };

      // Ha van reportTarget (pl. post / user), küldjük le a backendre
      if (reportTarget && reportTarget.id && reportTarget.type) {
        payload.targetId   = String(reportTarget.id);
        payload.targetType = String(reportTarget.type);
      }

      var result = await submitFn(payload);

      /* 5. Sikeres beküldés */
      if (loadingOverlay) loadingOverlay.classList.remove('active');
      closeReportPopup();

      if (window.showToastDirectly) {
        window.showToastDirectly(
          'Bejelentés elküldve',
          'A bejelentésed sikeresen beérkezett. Köszönjük!',
          'green', 'check'
        );
      }
      console.log('[Security] submitReport ok:', result.data);

    } catch (err) {
      /* 6. Hiba kezelés */
      if (loadingOverlay) loadingOverlay.classList.remove('active');

      var msg = 'Hiba történt a bejelentés beküldése során.';
      if (err && err.code === 'functions/resource-exhausted') {
        msg = err.message || 'Túl sok bejelentés rövid idő alatt. Próbáld újra később.';
      } else if (err && err.code === 'functions/unauthenticated') {
        msg = 'Bejelentkezés szükséges a bejelentés beküldéséhez.';
      } else if (err && err.message) {
        msg = err.message;
      }

      if (window.showToastDirectly) {
        window.showToastDirectly('Bejelentés sikertelen', msg, 'red', 'error');
      }
      console.error('[Security] submitReport error:', err);
    }
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

    /* Submit: Cloud Function hívás */
    var submitBtn = document.getElementById('secSubmitBtn');
    if (submitBtn) submitBtn.addEventListener('click', handleSubmitReport);

    /* Save: LocalStorage mentés (backend nélkül egyelőre) */
    var saveBtn = document.getElementById('secSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        return;
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
    window.securityUI = window.securityUI || {};
    window.securityUI.openManageMyClassVerifyPopup = openManageMyClassVerifyPopup;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}());

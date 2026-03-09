// Footer injector - dinamikusan beszúrja a footert az oldalakba
// Használat: <script src="assets/js/footer.js"></script> a </body> előtt
// A footer automatikusan a <footer class="site-footer"> helyére kerül, vagy a body végére

(function () {
  'use strict';

  // DSz Vote oldal: ne injektáljuk a globális footert
  try {
    var path = window.location && window.location.pathname ? window.location.pathname : '';
    if (path.endsWith('/vote.html') || path.endsWith('vote.html')) {
      return;
    }
  } catch (e) {
    // ha valamiért nincs location, akkor megy tovább a normál logika
  }

  // Ellenőrizzük, hogy már van-e injected footer
  if (document.getElementById('eu2k-injected-footer')) {
    return;
  }

  // Footer CSS betöltése
  function loadFooterCSS() {
    try {
      // Ellenőrizzük, hogy már nincs-e betöltve
      if (document.getElementById('eu2k-footer-css')) {
        return;
      }

      if (!document.head) {
        // Ha még nincs head, várunk
        setTimeout(loadFooterCSS, 50);
        return;
      }

      const link = document.createElement('link');
      link.id = 'eu2k-footer-css';
      link.rel = 'stylesheet';
      link.href = 'assets/css/footer.css';
      document.head.appendChild(link);
    } catch (e) {
      console.warn('[Footer] Could not load CSS:', e);
    }
  }

  // CSS betöltése azonnal
  loadFooterCSS();

  // Footer HTML generálása
  function createFooterHTML() {
    return `
      <!-- Left Column -->
      <div class="footer-left">
        <!-- Logo and participated section -->
        <div class="footer-logo-container">
          <img src="assets/general/footer/eu2k_hub.png" alt="EU2K Hub">
          <span class="footer-participated-text" data-translate="footer.participated">Részt vett még:</span>
          <div class="footer-participated-logos">
            <img src="assets/general/footer/eu2k.png" alt="EU2K">
            <img src="assets/general/footer/eu2k_devs.png" alt="EU2K Devs">
            <img src="assets/general/footer/eu2k_dok.png" alt="EU2K Dok">
            <img src="assets/general/footer/eu2k_ujsag.png" alt="EU2K Újság">
          </div>
        </div>

        <!-- Copyright -->
        <div class="footer-copyright" data-translate="footer.copyright">
          © 2025 EU2K Devs és Európa 2000 Gimnázium. All Rights Reserved.
        </div>

        <!-- Social icons -->
        <div class="footer-social">
          <img src="assets/general/footer/eu2k_ujsag.svg" alt="EU2K Újság" onclick="window.open('https://sites.google.com/view/eu2k-ujsag', '_blank')">
          <img src="assets/general/footer/x.svg" alt="X (Twitter)" onclick="window.open('https://x.com/eu2kdevs', '_blank')">
          <img src="assets/general/footer/instagram.svg" alt="Instagram" onclick="window.open('https://instagram.com/eu2k.devs', '_blank')">
          <img src="assets/general/footer/yt.svg" alt="YouTube" onclick="window.open('https://youtube.com/@eu2kdevs', '_blank')">
        </div>
      </div>

      <!-- Right Column -->
      <div class="footer-right">
        <!-- Jogi Nyilatkozatok -->
        <div class="footer-section-first">
          <div class="footer-section-title" data-translate="footer.legal.title">Jogi Nyilatkozatok</div>
          <div class="footer-section-items">
            <a href="privacy-policy.html" class="footer-item" data-translate="footer.legal.privacy">Adatvédelmi&nbsp;Tájékoztató</a>
            <a href="terms-of-service.html" class="footer-item" data-translate="footer.legal.terms">Használati&nbsp;Feltételek</a>
          </div>
        </div>

        <!-- Hubs -->
        <div class="footer-section">
          <div class="footer-section-title" data-translate="footer.hubs.title">Hubs</div>
          <div class="footer-section-items">
            <a href="youhub.html" class="footer-item">YouHub</a>
            <div class="footer-item">Class&nbsp;Hub<span class="beta-badge" data-translate="footer.hubs.soon" data-translate-fallback="SOON">SOON</span></div>
            <div class="footer-item">Food&nbsp;Hub<span class="beta-badge" data-translate="footer.hubs.soon" data-translate-fallback="SOON">SOON</span></div>
            <div class="footer-item">Event&nbsp;Hub<span class="beta-badge" data-translate="footer.hubs.soon" data-translate-fallback="SOON">SOON</span></div>
            <div class="footer-item">Fitness&nbsp;Hub<span class="beta-badge" data-translate="footer.hubs.soon" data-translate-fallback="SOON">SOON</span></div>
          </div>
        </div>
      </div>
    `;
  }

  // Footer beszúrása
  function injectFooter() {
    // Keresünk egy meglévő footer-t
    const existingFooter = document.querySelector('footer.site-footer');
    // Vote oldal saját footere – soha ne cseréljük le
    if (existingFooter && existingFooter.classList.contains('vote-footer')) {
      return;
    }
    if (existingFooter) {
      // Ha van meglévő footer, lecseréljük a tartalmát
      existingFooter.innerHTML = createFooterHTML();
      existingFooter.id = 'eu2k-injected-footer';
    } else {
      // Ha nincs, létrehozunk egy újat
      const footer = document.createElement('footer');
      footer.className = 'site-footer';
      footer.id = 'eu2k-injected-footer';
      footer.innerHTML = createFooterHTML();
      
      // Keresünk egy megfelelő helyet a beszúrásra
      const main = document.querySelector('main');
      if (main) {
        main.appendChild(footer);
      } else {
        // Ha nincs main, a body végére tesszük
        document.body.appendChild(footer);
      }
    }

    // Fordítási rendszer támogatás - ha van translationManager, alkalmazzuk a fordítást
    if (window.translationManager && window.translationManager.applyTranslations) {
      try {
        window.translationManager.applyTranslations();
      } catch (e) {
        console.warn('[Footer] Nem sikerült alkalmazni a fordítást:', e);
      }
    }
  }

  // Várunk a DOM betöltésére
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFooter);
  } else {
    // Ha már betöltődött, azonnal futtatjuk
    injectFooter();
  }
})();



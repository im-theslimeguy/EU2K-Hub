 Frissítési popup megjelenítéséhez:
    resetNewThingsPopup()

Értesítések tesztelése (konzol parancsok):
    testNotification(priority, buttonLabel) - Teszt értesítés megjelenítése
        priority: "green", "blue", "positive", "warning", "danger" (IDÉZŐJELEK KÖZÉ!)
        buttonLabel: A gomb szövege (pl. "Megnyitás", "Bezárás") (IDÉZŐJELEK KÖZÉ!)
        Példa: testNotification("warning", "Rendben")
        Példa: testNotification("blue", "Teszteld")
        Példa: testNotification("positive", "Oké")
    
    testAllNotifications() - Összes értesítés típus tesztelése (2 másodperces késleltetéssel)

Scan QR popup:
    setScanAuthSuccess() - Sikeres igazolás állapot
    setScanAuthFailed() - Sikertelen igazolás állapot
Show QR popup:
    setShowQrAuthSuccess() - Sikeres igazolás állapot
    setShowQrAuthFailed() - Sikertelen igazolás állapot
Code Entry popup:
    setCodeEntryAuthSuccess() - Sikeres igazolás állapot
 setCodeEntryAuthFailed() - Sikertelen igazolás állapot
Reset:
 resetAuthStates() - Visszaállítja az alapértelmezett állapotokat (scanner/QR kód/kód megjelenítése)

// 1) Minden, a staff / permission overlayhez köthető elem törlése
document.querySelectorAll('.permission-overlay-scroll-area, #staffTransferWaitingIndicator').forEach(el => el.remove());

// 2) Vegyük le a scroll tiltást / “popup-active” állapotot
document.querySelectorAll('.main-scroll-area').forEach(el => {
  el.classList.remove('no-scroll', 'popup-active');
  el.style.filter = 'none';
  el.style.backdropFilter = 'none';
});

// 3) Globálisan kapcsoljuk ki a blur / backdrop-filtert és engedjük a kattintást
Array.from(document.querySelectorAll('*')).forEach(el => {
  const style = getComputedStyle(el);
  if (style.filter.includes('blur') || style.backdropFilter && style.backdropFilter !== 'none') {
    el.style.filter = 'none';
    el.style.backdropFilter = 'none';
  }
  if (style.pointerEvents === 'none') {
    el.style.pointerEvents = 'auto';
  }
});
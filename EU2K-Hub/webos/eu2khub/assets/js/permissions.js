// Permission Toast Rendszer
// Használat: <script src="/assets/js/permissions.js"></script>

// Permission toast megjelenítő függvény
function showPermissionToast(iconPath, message) {
  // Meglévő permission toast eltávolítása
  const existingToasts = document.querySelectorAll('.permission-toast');
  existingToasts.forEach(toast => toast.remove());

  // Új permission toast létrehozása
  const toast = document.createElement('div');
  toast.className = 'permission-toast';
  toast.innerHTML = `
    <img src="${iconPath}" class="permission-icon" alt="Permission">
    <span>${message}</span>
  `;
  document.body.appendChild(toast);

  // CSS hozzáadása ha még nincs
  addPermissionCSS();

  // Megjelenítés animációval
  setTimeout(() => toast.classList.add('show'), 100);

  // 3 másodperc után kicsinyül kis gombba
  setTimeout(() => {
    shrinkToMiniButton(toast, iconPath, message);
  }, 3000);
}

function shrinkToMiniButton(toast, iconPath, message) {
  // Header icons container keresése
  const headerIcons = document.querySelector('.header-icons');
  let targetButton;

  // Oldal alapján célgomb meghatározása
  const currentPage = window.location.pathname;
  if (currentPage.includes('youhub.html')) {
    targetButton = headerIcons?.querySelector('a[href="./settings/settings.html"]') ||
      headerIcons?.querySelector('a[href="./settings/settings.html"]');
  } else {
    // Minden más oldalon a fiók gomb elé
    targetButton = headerIcons?.querySelector('a[href="./system/account.html"]') ||
      headerIcons?.querySelector('a[href="./system/account.html"]');
  }

  if (headerIcons && targetButton) {
    // Mini gomb létrehozása
    const miniButton = document.createElement('div');
    miniButton.className = 'permission-mini-button';
    miniButton.innerHTML = `<img src="${iconPath}" alt="Permission">`;
    miniButton.dataset.message = message;
    miniButton.dataset.icon = iconPath;

    // Célgomb elé beszúrás
    headerIcons.insertBefore(miniButton, targetButton);

    // Toast eltávolítása
    toast.classList.add('shrink');
    setTimeout(() => toast.remove(), 300);

    // Hover effekt a mini gombra
    miniButton.addEventListener('mouseenter', () => {
      expandMiniButton(miniButton);
    });
  } else {
    // Ha nincs header icons vagy target button, egyszerűen eltávolítja a toast-ot
    console.log('Header icons vagy target button nem található, toast eltávolítása');
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 400);
  }
}

function expandMiniButton(miniButton) {
  const iconPath = miniButton.dataset.icon;
  const message = miniButton.dataset.message;

  // Meglévő expanded toast eltávolítása
  const existingExpanded = document.querySelector('.permission-toast.expanded');
  if (existingExpanded) {
    existingExpanded.remove();
  }

  // Átmeneti nagy toast létrehozása
  const expandedToast = document.createElement('div');
  expandedToast.className = 'permission-toast expanded';
  expandedToast.innerHTML = `
    <img src="${iconPath}" class="permission-icon" alt="Permission">
    <span>${message}</span>
  `;

  document.body.appendChild(expandedToast);
  setTimeout(() => expandedToast.classList.add('show'), 100);

  // 5 másodperc után visszakicsinyül
  setTimeout(() => {
    expandedToast.classList.remove('show');
    expandedToast.classList.add('hide');
    setTimeout(() => expandedToast.remove(), 400);
  }, 5000);
}

// Permission ellenőrzés csak amikor tényleg használja
async function checkAndShowPermissions() {
  try {
    let cameraPermission = false;
    let microphonePermission = false;

    // Kamera engedély ellenőrzése - csak ha tényleg használja
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraPermission = true;
      // Stream aktív marad - tényleg használja
      window.activePermissionStreams = window.activePermissionStreams || [];
      window.activePermissionStreams.push(cameraStream);
    } catch (e) {
      cameraPermission = false;
    }

    // Mikrofon engedély ellenőrzése - csak ha tényleg használja  
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphonePermission = true;
      // Stream aktív marad - tényleg használja
      window.activePermissionStreams = window.activePermissionStreams || [];
      window.activePermissionStreams.push(micStream);
    } catch (e) {
      microphonePermission = false;
    }

    // Meglévő mini gombok eltávolítása ha both lesz
    if (cameraPermission && microphonePermission) {
      // Eltávolítja a külön kamera és mikrofon gombokat
      const existingCam = document.querySelector('.permission-mini-button[data-icon*="camera"]');
      const existingMic = document.querySelector('.permission-mini-button[data-icon*="mic"]');
      if (existingCam) existingCam.remove();
      if (existingMic) existingMic.remove();

      showPermissionToast('./assets/qr-code/cam_mic_permission.svg', 'Mikrofon és Kamera Hozzáférés');
    } else if (cameraPermission) {
      // Ne jelenjen meg ha már van both
      const existingBoth = document.querySelector('.permission-mini-button[data-icon*="cam_mic"]');
      if (!existingBoth) {
        showPermissionToast('./assets/qr-code/camera_permission.svg', 'Kamera Hozzáférés');
      }
    } else if (microphonePermission) {
      // Ne jelenjen meg ha már van both
      const existingBoth = document.querySelector('.permission-mini-button[data-icon*="cam_mic"]');
      if (!existingBoth) {
        showPermissionToast('./assets/qr-code/mic_permission.svg', 'Mikrofon Hozzáférés');
      }
    }

  } catch (error) {
    console.error('Permission check error:', error);
  }
}

// Streamek leállítása amikor már nem kell
function stopPermissionStreams() {
  if (window.activePermissionStreams) {
    window.activePermissionStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    window.activePermissionStreams = [];
  }
}

// CSS hozzáadása
function addPermissionCSS() {
  if (document.getElementById('permission-styles')) return;

  const style = document.createElement('style');
  style.id = 'permission-styles';
  style.textContent = `
    /* Permission Toast */
    .permission-toast {
      position: fixed;
      top: 30px;
      right: 32px;
      background: #81BE75;
      color: #20381B;
      padding: 16px 24px;
      border-radius: 32px;
      font-size: 0.9rem;
      font-weight: 500;
      box-shadow: 0 4px 16px #00000033;
      z-index: 3000;
      opacity: 0;
      transform: translateX(100px) scale(0.8);
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .permission-toast.show {
      opacity: 1;
      transform: translateX(0) scale(1);
    }

    .permission-toast.hide {
      opacity: 0;
      transform: translateX(100px) scale(0.8);
    }

    .permission-toast.shrink {
      opacity: 0;
      transform: scale(0.1) translateX(100px);
    }

    .permission-toast.expanded {
      top: 30px;
      animation: slideInFromRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes slideInFromRight {
      from {
        opacity: 0;
        transform: translateX(100px) scale(0.8);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }

    .permission-icon {
      width: 20px;
      height: 20px;
    }

    /* Mini Permission Button - zöld háttér */
    .permission-mini-button {
      background-color: #81BE75;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: var(--transition);
      margin-right: 2px;
    }

    .permission-mini-button:hover {
      background-color: var(--card-bg);
    }

    .permission-mini-button img {
      width: 24px;
      height: 24px;
    }
  `;
  document.head.appendChild(style);
}

// Console tesztelés függvények - automatikusan both permission ha mindkettő kell
window.testCameraPermission = () => {
  // Ha már van both permission, ne csináljon semmit
  const existingBoth = document.querySelector('.permission-mini-button[data-icon*="cam_mic"]');
  if (existingBoth) return;

  // Ha már van mikrofon permission, akkor both-ot mutat és eltávolítja a mic gombot
  const existingMic = document.querySelector('.permission-mini-button[data-icon*="mic"]');
  if (existingMic) {
    existingMic.remove();
    showPermissionToast('./assets/qr-code/cam_mic_permission.svg', 'Mikrofon és Kamera Hozzáférés');
  } else {
    showPermissionToast('./assets/qr-code/camera_permission.svg', 'Kamera Hozzáférés');
  }
};

window.testMicPermission = () => {
  // Ha már van both permission, ne csináljon semmit
  const existingBoth = document.querySelector('.permission-mini-button[data-icon*="cam_mic"]');
  if (existingBoth) return;

  // Ha már van kamera permission, akkor both-ot mutat és eltávolítja a camera gombot
  const existingCam = document.querySelector('.permission-mini-button[data-icon*="camera"]');
  if (existingCam) {
    existingCam.remove();
    showPermissionToast('./assets/qr-code/cam_mic_permission.svg', 'Mikrofon és Kamera Hozzáférés');
  } else {
    showPermissionToast('./assets/qr-code/mic_permission.svg', 'Mikrofon Hozzáférés');
  }
};

window.testBothPermissions = () => showPermissionToast('./assets/qr-code/cam_mic_permission.svg', 'Mikrofon és Kamera Hozzáférés');
window.testRealPermissions = checkAndShowPermissions;
window.stopStreams = stopPermissionStreams;

// Manuális inicializálás - csak akkor hívd meg amikor tényleg használod a kamerát/mikrofont
// Használat: checkAndShowPermissions()

// Automatikus inicializálás kikapcsolva - csak manuálisan
// document.addEventListener('DOMContentLoaded', checkAndShowPermissions);
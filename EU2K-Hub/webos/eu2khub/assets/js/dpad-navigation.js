/* Lightweight DPAD / arrow-key spatial navigation for webOS TVs
   - Makes common interactive elements focusable (adds tabindex=0)
   - Injects a visible :focus style for TV navigation
   - Handles arrow keys to move focus to the nearest element in that direction
   - Handles Enter to trigger click on the focused element
   No external libraries used.
*/
(function(){
  'use strict';

  // Scope selector: limit navigation to this container if present
  const SCOPE_SELECTOR = '.main-content';
  const SELECTORS = 'button, a[href], [role="button"], input, textarea, select, md-filled-button, md-switch, md-radio, .settings-card, .category-item, .community-suggestion-item, .nav-item, .general-language-card, .general-language-card *, .avatar-option';

  function makeFocusable(){
  const root = document.querySelector(SCOPE_SELECTOR) || document;
  root.querySelectorAll(SELECTORS).forEach(el=>{
      // Skip elements that are intentionally non-focusable
      if(el.hasAttribute('data-dpad-ignore')) return;
      if(el.getAttribute('tabindex') === null) {
        el.setAttribute('tabindex','0');
      }
      // Ensure keyboard Enter triggers click
      el.addEventListener('keydown', e => {
        if(e.keyCode === 13) {
          e.preventDefault();
          triggerClick(el);
        }
      });
    });

    // Inject focus style for TV (only once)
    if(!document.getElementById('dpad-focus-style')){
      const s = document.createElement('style');
      s.id = 'dpad-focus-style';
      s.textContent = '\n:focus{outline:3px solid #ffcc00;outline-offset:4px;}\nbutton:focus, a:focus{box-shadow:0 0 0 3px #FFCC0024;}\n';
      document.head.appendChild(s);
    }
  }

  function getScopeContainer(){
    return document.querySelector(SCOPE_SELECTOR) || document;
  }

  function getFocusable(){
    const root = getScopeContainer();
    return Array.from(root.querySelectorAll(SELECTORS)).filter(el=>{
      if(el.hasAttribute('data-dpad-ignore')) return false;
      if(el.hasAttribute('disabled')) return false;
      // visible
      try{ if(!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)) return false; }catch(e){ }
      return true;
    });
  }

  function ensureVisible(el, root){
    try{
      if(root === document){ el.scrollIntoView({block:'nearest', inline:'nearest'}); return; }
      // Only scroll the root container, not the whole document
      if(root.scrollHeight > root.clientHeight){
        const r = el.getBoundingClientRect();
        const cr = root.getBoundingClientRect();
        const offsetTop = r.top - cr.top; const offsetBottom = r.bottom - cr.bottom;
        if(offsetTop < 0) root.scrollTop += offsetTop - 8;
        else if(offsetBottom > 0) root.scrollTop += offsetBottom + 8;
      } else {
        // fallback
        el.scrollIntoView({block:'nearest', inline:'nearest'});
      }
    }catch(e){}
  }

  function moveFocus(direction){
    const root = getScopeContainer();
    const focusables = getFocusable();
    if(!focusables.length) return;
    const active = document.activeElement;
    let idx = focusables.indexOf(active);
    if(idx === -1){ focusables[0].focus(); return; }

    const rect = active.getBoundingClientRect();
    let best = null; let bestScore = Infinity;

    focusables.forEach(c => {
      if(c === active) return;
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      const ax = rect.left + rect.width/2, ay = rect.top + rect.height/2;
      const dx = cx - ax, dy = cy - ay;
      let score = Infinity;
      if(direction === 'left' && dx < 0) score = Math.hypot(dx, dy) - Math.abs(dx)*1.5;
      if(direction === 'right' && dx > 0) score = Math.hypot(dx, dy) - Math.abs(dx)*1.5;
      if(direction === 'up' && dy < 0) score = Math.hypot(dx, dy) - Math.abs(dy)*1.5;
      if(direction === 'down' && dy > 0) score = Math.hypot(dx, dy) - Math.abs(dy)*1.5;
      if(score < bestScore){ bestScore = score; best = c; }
    });

    if(best) { best.focus(); ensureVisible(best, root); return; }
    // fallback linear
    if(direction === 'left' || direction === 'up'){
      const ni = (idx - 1 + focusables.length) % focusables.length; focusables[ni].focus(); ensureVisible(focusables[ni], root);
    } else {
      const ni = (idx + 1) % focusables.length; focusables[ni].focus(); ensureVisible(focusables[ni], root);
    }
  }

    // Robust click trigger which first tries native click(), then synthesizes mouse events.
    function triggerClick(target) {
      if(!target) return;
      try { target.focus(); } catch (e) {}

      // Prefer native click
      try {
        if(typeof target.click === 'function') {
          target.click();
          return;
        }
      } catch (e) {
        // fallthrough to synthesized events
      }

      const evOpts = { bubbles: true, cancelable: true, composed: true, view: window };
      // Dispatch pointer events first (some handlers listen for pointer/touch)
      try {
        if(window.PointerEvent) {
          try { target.dispatchEvent(new PointerEvent('pointerdown', evOpts)); } catch(e){}
          try { target.dispatchEvent(new PointerEvent('pointerup', evOpts)); } catch(e){}
        }
      } catch (e) {}

      // Then mouse events
      try {
        try { target.dispatchEvent(new MouseEvent('mousedown', evOpts)); } catch(e){}
        try { target.dispatchEvent(new MouseEvent('mouseup', evOpts)); } catch(e){}
        try { target.dispatchEvent(new MouseEvent('click', evOpts)); } catch(e){}
      } catch (e) {
        try { target.dispatchEvent(new Event('click', evOpts)); } catch (e2) { /* no-op */ }
      }
    }

    document.addEventListener('keydown', e => {
    const code = e.keyCode;
    // ignore unrelated keys
    if([37,38,39,40,13].indexOf(code) === -1) return;
    // if typing in an input/textarea skip directional handling
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)){
      return;
    }
    switch(code){
      case 37: e.preventDefault(); moveFocus('left'); break;
      case 38: e.preventDefault(); moveFocus('up'); break;
      case 39: e.preventDefault(); moveFocus('right'); break;
      case 40: e.preventDefault(); moveFocus('down'); break;
      case 13: e.preventDefault(); if(document.activeElement){ const root = getScopeContainer(); ensureVisible(document.activeElement, root); triggerClick(document.activeElement); } break;
    }
  });

  window.addEventListener('load', () => { try{ makeFocusable(); }catch(e){ console.warn('DPAD init failed', e); } });

  // Expose for debugging and manual calls
  window.DPadNav = { makeFocusable, getFocusable, moveFocus };
})();

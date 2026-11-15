/**
 * touch.js — As Quatro Chamas de Nzila
 * Controles virtuais na tela (Android/iOS) integrados ao Input.
 *
 * Dependência: js/input.js carregado ANTES.
 *
 * Controles:
 *   - D-Pad analógico de 8 direções (esquerda). Empurrar até a borda = correr.
 *   - ATQ   (J)     -> attack
 *   - ECO   (L)     -> eco
 *   - CORRER(Shift) -> run (segurar)
 *
 * Cria seu próprio DOM e CSS (não depende do style.css).
 * Esconde-se automaticamente quando um gamepad/arcade é conectado e
 * reaparece ao tocar na tela.
 *
 * API (window.Touch):
 *   Touch.init({ force:false, autoHideOnGamepad:true, fullscreen:true })
 *   Touch.show() / Touch.hide() / Touch.destroy()
 *   Touch.isVisible()
 */
(function (global) {
  'use strict';

  const CSS = `
  html, body { touch-action: none; overscroll-behavior: none; }
  #nz-touch { position: fixed; inset: 0; z-index: 50; pointer-events: none; display: none;
    --b: min(16dvh, 14vw, 84px); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent; }
  #nz-touch.on { display: block; }
  #nz-touch > * { pointer-events: auto; touch-action: none; }
  #nz-stick { position: absolute; width: calc(var(--b) * 3); height: calc(var(--b) * 3);
    left: calc(var(--b) * .3 + env(safe-area-inset-left, 0px));
    bottom: calc(var(--b) * .3 + env(safe-area-inset-bottom, 0px));
    border-radius: 50%; background: rgba(20,12,30,.45); border: 3px solid rgba(255,220,150,.45); }
  #nz-stick .a { position: absolute; color: rgba(255,230,180,.7); font: calc(var(--b) * .4)/1 sans-serif; pointer-events: none; }
  #nz-stick .u { top: 8%; left: 50%; transform: translateX(-50%); }
  #nz-stick .d { bottom: 8%; left: 50%; transform: translateX(-50%); }
  #nz-stick .l { left: 8%; top: 50%; transform: translateY(-50%); }
  #nz-stick .r { right: 8%; top: 50%; transform: translateY(-50%); }
  #nz-knob { position: absolute; left: 50%; top: 50%; width: calc(var(--b) * 1.1); height: calc(var(--b) * 1.1);
    margin: calc(var(--b) * -.55) 0 0 calc(var(--b) * -.55); border-radius: 50%;
    background: rgba(255,210,120,.55); pointer-events: none; }
  .nz-btn { position: absolute; border-radius: 50%; padding: 0; color: #fff; opacity: .85;
    font: bold calc(var(--b) * .24) sans-serif; width: var(--b); height: var(--b);
    background: rgba(20,12,30,.5); border: 3px solid #fff;
    right: calc(env(safe-area-inset-right, 0px) + var(--rx) * var(--b));
    bottom: calc(env(safe-area-inset-bottom, 0px) + var(--by) * var(--b)); }
  .nz-btn.on { background: rgba(255,255,255,.55); transform: scale(.93); }
  .nz-atk { --rx: .3; --by: .3; width: calc(var(--b) * 1.4); height: calc(var(--b) * 1.4); border-color: #ff7a3a; }
  .nz-eco { --rx: 1.9; --by: .3; border-color: #5cf; }
  .nz-run { --rx: .55; --by: 1.9; border-color: #ffd36b; }
  `;

  const STICK_RUN_THRESHOLD = 0.9;  // fração do raio que ativa a corrida
  const STICK_DEADZONE = 0.2;       // fração do raio ignorada no centro

  let root = null;
  let styleEl = null;
  let cleanup = [];
  let opts = null;
  let hiddenByPad = false;
  let fullscreenTried = false;
  let runStick = false;
  let runButton = false;

  function isTouchDevice() {
    return 'ontouchstart' in global ||
      (navigator.maxTouchPoints || 0) > 0 ||
      (global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  }

  function on(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    cleanup.push(() => target.removeEventListener(type, fn, options));
  }

  function updateRun() {
    global.Input.setVirtual('run', runStick || runButton);
  }

  /** D-Pad analógico com quantização em 8 direções. */
  function buildStick() {
    const stick = document.createElement('div');
    stick.id = 'nz-stick';
    stick.innerHTML = '<span class="a u">▲</span><span class="a d">▼</span>' +
      '<span class="a l">◀</span><span class="a r">▶</span><i id="nz-knob"></i>';
    const knob = stick.querySelector('#nz-knob');
    let activeId = null;

    function update(e) {
      const r = stick.getBoundingClientRect();
      const R = r.width / 2;
      const dx = e.clientX - (r.left + R);
      const dy = e.clientY - (r.top + R);
      const d = Math.hypot(dx, dy) || 1;
      const m = d / R;

      if (m < STICK_DEADZONE) {
        global.Input.setVirtualAxis(0, 0);
        runStick = false;
      } else {
        const step = Math.PI / 4;
        const ang = Math.round(Math.atan2(dy, dx) / step) * step; // snap 8 direções
        global.Input.setVirtualAxis(Math.cos(ang), Math.sin(ang));
        runStick = m >= STICK_RUN_THRESHOLD;
      }
      updateRun();

      const k = Math.min(d, R * 0.6);
      knob.style.transform = 'translate(' + (dx / d * k) + 'px,' + (dy / d * k) + 'px)';
    }

    function end(e) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      knob.style.transform = '';
      runStick = false;
      global.Input.setVirtualAxis(0, 0);
      updateRun();
    }

    on(stick, 'pointerdown', (e) => {
      e.preventDefault();
      activeId = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
      update(e);
    });
    on(stick, 'pointermove', (e) => { if (e.pointerId === activeId) update(e); });
    on(stick, 'pointerup', end);
    on(stick, 'pointercancel', end);
    on(stick, 'lostpointercapture', end);
    return stick;
  }

  function makeButton(cls, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nz-btn ' + cls;
    b.textContent = label;
    return b;
  }

  /** Efeito visual de pressionado + liga ao Input. */
  function bindAction(btn, action) {
    const press = () => btn.classList.add('on');
    const release = () => btn.classList.remove('on');
    on(btn, 'pointerdown', press);
    on(btn, 'pointerup', release);
    on(btn, 'pointercancel', release);
    on(btn, 'lostpointercapture', release);
    cleanup.push(global.Input.bindButton(btn, action));
  }

  function buildRunButton(btn) {
    const set = (v) => (e) => {
      e.preventDefault();
      if (v) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ } }
      runButton = v;
      btn.classList.toggle('on', v);
      updateRun();
    };
    on(btn, 'pointerdown', set(true));
    on(btn, 'pointerup', set(false));
    on(btn, 'pointercancel', set(false));
    on(btn, 'lostpointercapture', set(false));
  }

  /** Tela cheia + paisagem no primeiro toque (melhora muito a jogabilidade no Android). */
  function tryFullscreen() {
    if (fullscreenTried || !opts.fullscreen || document.fullscreenElement) return;
    fullscreenTried = true;
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen()
          .then(() => (global.screen.orientation && global.screen.orientation.lock
            ? global.screen.orientation.lock('landscape') : null))
          .catch(() => {});
      }
    } catch (err) { /* ignora */ }
  }

  const Touch = {
    init(options) {
      if (root) return;
      if (!global.Input) { console.warn('[Touch] input.js não encontrado.'); return; }
      opts = Object.assign({ force: false, autoHideOnGamepad: true, fullscreen: true }, options || {});
      global.Input.init();

      styleEl = document.createElement('style');
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);

      root = document.createElement('div');
      root.id = 'nz-touch';
      const atk = makeButton('nz-atk', 'ATQ');
      const eco = makeButton('nz-eco', 'ECO');
      const run = makeButton('nz-run', 'CORRER');
      root.appendChild(buildStick());
      root.appendChild(atk);
      root.appendChild(eco);
      root.appendChild(run);
      document.body.appendChild(root);

      bindAction(atk, 'attack');
      bindAction(eco, 'eco');
      buildRunButton(run);

      on(root, 'contextmenu', (e) => e.preventDefault());
      on(document, 'gesturestart', (e) => e.preventDefault());
      on(document, 'pointerup', (e) => { if (e.pointerType === 'touch') tryFullscreen(); });

      // Esconde ao conectar gamepad/arcade; volta ao tocar na tela.
      if (opts.autoHideOnGamepad) {
        const prev = global.Input.onGamepadChange;
        global.Input.onGamepadChange = (connected, id) => {
          if (typeof prev === 'function') prev(connected, id);
          if (connected) { hiddenByPad = true; Touch.hide(); }
          else { hiddenByPad = false; if (opts.force || isTouchDevice()) Touch.show(); }
        };
        on(document, 'pointerdown', (e) => {
          if (hiddenByPad && e.pointerType === 'touch') { hiddenByPad = false; Touch.show(); }
        });
      }

      if (opts.force || isTouchDevice()) Touch.show();
    },

    show() { if (root) root.classList.add('on'); },

    hide() {
      if (!root) return;
      root.classList.remove('on');
      runStick = runButton = false;
      global.Input.setVirtualAxis(0, 0);
      updateRun();
    },

    isVisible() { return !!root && root.classList.contains('on'); },

    destroy() {
      cleanup.forEach((fn) => fn());
      cleanup = [];
      if (root) root.remove();
      if (styleEl) styleEl.remove();
      root = styleEl = null;
    }
  };

  global.Touch = Touch;
})(window);

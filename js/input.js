/**
 * input.js — As Quatro Chamas de Nzila
 * Gerenciador de entrada unificado: TECLADO + TOUCH (via touch.js) + GAMEPAD/ARCADE (USB OTG).
 *
 * Ações: up, down, left, right, run, attack, eco
 * Teclado: W A S D = mover | Shift = correr | J = ataque | L = Eco
 * Gamepad (mapping "standard"): D-Pad/analógico esquerdo = mover | LB/RB/LT/RT = correr
 *                               A/X = ataque | B/Y = Eco
 * Gamepad genérico (encoders arcade): eixos 0/1 (ou hat no eixo 9) = mover
 *                               botões 0/2 = ataque | 1/3 = Eco | 4-7 = correr
 *   -> tudo remapeável com Input.setGamepadMap().
 *
 * Observação (Android/Chrome): o gamepad só é exposto ao navegador depois que
 * UM botão dele é pressionado com a página em foco.
 *
 * Se o encoder arcade for reconhecido como TECLADO, basta mapear os botões
 * para W, A, S, D, Shift, J e L — o teclado continua funcionando normalmente.
 *
 * API pública (window.Input):
 *   Input.init()                    -> registra listeners (idempotente)
 *   Input.isDown(action)            -> true enquanto a ação estiver ativa
 *   Input.wasPressed(action)        -> true somente no frame em que foi pressionada
 *   Input.wasReleased(action)       -> true somente no frame em que foi solta
 *   Input.getAxis()                 -> { x, y } em [-1, 1] (teclado > gamepad > virtual)
 *   Input.setVirtual(action, bool)  -> aciona/solta ação via UI touch
 *   Input.setVirtualAxis(x, y)      -> eixo virtual (joystick touch)
 *   Input.bindButton(el, action)    -> liga elemento DOM a uma ação (Pointer Events)
 *   Input.poll()                    -> lê gamepads (chamado automaticamente pelos getters)
 *   Input.hasGamepad()              -> true se houver gamepad conectado
 *   Input.getGamepadName()          -> id do gamepad ativo ('' se nenhum)
 *   Input.setGamepadMap(map)        -> remapeia botões, ex.: { attack:[0], eco:[1], run:[5] }
 *   Input.getGamepadMap()           -> mapa atual (cópia)
 *   Input.onGamepadChange           -> callback (connected:boolean, id:string) => void
 *   Input.endFrame()                -> DEVE ser chamado ao final de cada frame
 *   Input.reset()                   -> solta todas as ações
 */
(function (global) {
  'use strict';

  /** Mapeamento por e.code (independe do layout do teclado). */
  const KEY_MAP = Object.freeze({
    KeyW: 'up',
    KeyA: 'left',
    KeyS: 'down',
    KeyD: 'right',
    ShiftLeft: 'run',
    ShiftRight: 'run',
    KeyJ: 'attack',
    KeyL: 'eco'
  });

  const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'run', 'attack', 'eco']);

  /** Mapa de botões do gamepad (índices da Gamepad API). */
  const DEFAULT_PAD_MAP = {
    attack: [0, 2],
    eco: [1, 3],
    run: [4, 5, 6, 7],
    up: [12],
    down: [13],
    left: [14],
    right: [15]
  };
  /** Em gamepads sem mapping "standard" não assumimos botões de direção. */
  const GENERIC_DIR_MAP = { up: [], down: [], left: [], right: [] };

  const DEADZONE = 0.25;     // zona morta radial do analógico
  const POLL_MIN_MS = 2;     // evita reler gamepads várias vezes no mesmo frame

  /** Fontes independentes por ação, para as entradas não se cancelarem. */
  const keyboard = {};
  const virtual = {};
  const gamepad = {};
  const pressed = {};
  const released = {};
  const prevDown = {};
  const virtualAxis = { x: 0, y: 0 };
  const padAxis = { x: 0, y: 0 };
  let padMap = clone(DEFAULT_PAD_MAP);
  const customMap = {};      // ações remapeadas pelo usuário
  let padId = '';
  let lastPoll = 0;
  let initialized = false;

  ACTIONS.forEach((a) => {
    keyboard[a] = false;
    virtual[a] = false;
    gamepad[a] = false;
    pressed[a] = false;
    released[a] = false;
    prevDown[a] = false;
  });

  function clone(map) {
    const out = {};
    Object.keys(map).forEach((k) => { out[k] = map[k].slice(); });
    return out;
  }

  /** Estado atual combinado de uma ação. */
  function down(action) {
    return keyboard[action] === true || virtual[action] === true || gamepad[action] === true;
  }

  /** Registra transição de estado (edge detection). */
  function syncEdges(action) {
    const now = down(action);
    if (now && !prevDown[action]) pressed[action] = true;
    if (!now && prevDown[action]) released[action] = true;
    prevDown[action] = now;
  }

  /* ---------------------------- TECLADO ---------------------------- */

  function onKeyDown(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (keyboard[action]) return; // ignora auto-repeat
    keyboard[action] = true;
    syncEdges(action);
  }

  function onKeyUp(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    keyboard[action] = false;
    syncEdges(action);
  }

  /* ---------------------------- GAMEPAD ---------------------------- */

  /** Decodifica o hat (POV) reportado como eixo 9: valores -1 ... 1 em passos de 2/7. */
  function decodeHat(v) {
    if (typeof v !== 'number' || v > 1.1 || v < -1.1) return null; // neutro (~1.29)
    const i = Math.round((v + 1) * 3.5);                           // 0..7
    return [
      [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]
    ][i] || null;
  }

  function readPads() {
    try {
      return navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch (err) {
      return [];
    }
  }

  /** Lê todos os gamepads conectados e atualiza as ações. */
  function poll(force) {
    const now = performance.now();
    if (!force && now - lastPoll < POLL_MIN_MS) return;
    lastPoll = now;

    const next = {};
    ACTIONS.forEach((a) => { next[a] = false; });
    let ax = 0;
    let ay = 0;
    let id = '';

    readPads().forEach((pad) => {
      if (!pad || !pad.connected) return;
      id = id || pad.id;
      const standard = pad.mapping === 'standard';

      const btn = (i) => {
        const b = pad.buttons[i];
        return !!b && (b.pressed || b.value > 0.5);
      };
      const hasAny = (list) => !!list && list.some(btn);

      // Botões (ações e, no mapping standard, direções digitais)
      ACTIONS.forEach((a) => {
        let list = padMap[a];
        if (!standard && GENERIC_DIR_MAP[a] && !customMap[a]) list = GENERIC_DIR_MAP[a]; // sem direções por botão, salvo remapeado
        if (hasAny(list)) next[a] = true;
      });

      // Eixos analógicos / alavanca arcade (digital ±1) com zona morta radial
      let x = pad.axes[0] || 0;
      let y = pad.axes[1] || 0;
      if (Math.hypot(x, y) < DEADZONE) { x = 0; y = 0; }

      // Hat/POV em encoders arcade (eixo 9)
      if (!standard && pad.axes.length > 9 && x === 0 && y === 0) {
        const hat = decodeHat(pad.axes[9]);
        if (hat) { x = hat[0]; y = hat[1]; }
      }
      if (Math.hypot(x, y) > Math.hypot(ax, ay)) { ax = x; ay = y; }
    });

    padAxis.x = ax;
    padAxis.y = ay;

    // Conexão / desconexão
    if (id !== padId) {
      const connected = id !== '';
      padId = id;
      if (typeof Input.onGamepadChange === 'function') Input.onGamepadChange(connected, id);
    }

    ACTIONS.forEach((a) => {
      gamepad[a] = next[a];
      syncEdges(a);
    });
  }

  /* ------------------------------ API ------------------------------ */

  const Input = {
    /** Callback opcional: (connected:boolean, id:string) => void */
    onGamepadChange: null,

    /** Registra listeners globais. Pode ser chamado mais de uma vez com segurança. */
    init() {
      if (initialized) return;
      initialized = true;
      global.addEventListener('keydown', onKeyDown);
      global.addEventListener('keyup', onKeyUp);
      global.addEventListener('blur', () => Input.reset());
      global.addEventListener('gamepadconnected', () => poll(true));
      global.addEventListener('gamepaddisconnected', () => poll(true));
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) Input.reset();
      });
    },

    /** Força a leitura dos gamepads (opcional: os getters já fazem isso). */
    poll() {
      poll(true);
    },

    isDown(action) {
      poll(false);
      return down(action);
    },

    wasPressed(action) {
      poll(false);
      return pressed[action] === true;
    },

    wasReleased(action) {
      poll(false);
      return released[action] === true;
    },

    /**
     * Eixo de movimento (NÃO normalizado para diagonais; o Player normaliza).
     * Prioridade: teclado/botões digitais > analógico do gamepad > analógico virtual.
     */
    getAxis() {
      poll(false);
      let x = 0;
      let y = 0;
      if (down('left')) x -= 1;
      if (down('right')) x += 1;
      if (down('up')) y -= 1;
      if (down('down')) y += 1;
      if (x === 0 && y === 0) {
        x = padAxis.x;
        y = padAxis.y;
      }
      if (x === 0 && y === 0) {
        x = virtualAxis.x;
        y = virtualAxis.y;
      }
      return { x, y };
    },

    /** Aciona/solta uma ação por UI virtual (botões touch). */
    setVirtual(action, isDown) {
      if (!(action in virtual)) return;
      virtual[action] = !!isDown;
      syncEdges(action);
    },

    /** Define o eixo virtual (cada valor limitado a [-1, 1]). */
    setVirtualAxis(x, y) {
      virtualAxis.x = Math.max(-1, Math.min(1, +x || 0));
      virtualAxis.y = Math.max(-1, Math.min(1, +y || 0));
    },

    /**
     * Liga um elemento DOM a uma ação usando Pointer Events (multi-toque).
     * Retorna função para remover os listeners.
     */
    bindButton(element, action) {
      if (!element || !(action in virtual)) return () => {};
      const start = (e) => {
        e.preventDefault();
        try { element.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
        Input.setVirtual(action, true);
      };
      const end = (e) => {
        e.preventDefault();
        Input.setVirtual(action, false);
      };
      element.addEventListener('pointerdown', start);
      element.addEventListener('pointerup', end);
      element.addEventListener('pointercancel', end);
      element.addEventListener('lostpointercapture', end);
      return () => {
        element.removeEventListener('pointerdown', start);
        element.removeEventListener('pointerup', end);
        element.removeEventListener('pointercancel', end);
        element.removeEventListener('lostpointercapture', end);
      };
    },

    hasGamepad() {
      poll(false);
      return padId !== '';
    },

    getGamepadName() {
      poll(false);
      return padId;
    },

    /**
     * Remapeia botões do gamepad. Aceita mapa parcial:
     *   Input.setGamepadMap({ attack: [0], eco: [1], run: [5] })
     */
    setGamepadMap(map) {
      if (!map || typeof map !== 'object') return;
      Object.keys(map).forEach((a) => {
        if (ACTIONS.indexOf(a) === -1) return;
        const list = Array.isArray(map[a]) ? map[a] : [map[a]];
        padMap[a] = list.filter((n) => Number.isInteger(n) && n >= 0);
        customMap[a] = true;
      });
    },

    getGamepadMap() {
      return clone(padMap);
    },

    /** Limpa flags de "pressionado/solto neste frame". Chamar no fim de cada frame. */
    endFrame() {
      for (let i = 0; i < ACTIONS.length; i++) {
        const a = ACTIONS[i];
        pressed[a] = false;
        released[a] = false;
      }
    },

    /** Solta todas as ações (perda de foco, pausa, troca de cena). */
    reset() {
      for (let i = 0; i < ACTIONS.length; i++) {
        const a = ACTIONS[i];
        keyboard[a] = false;
        virtual[a] = false;
        gamepad[a] = false;
        syncEdges(a);
      }
      virtualAxis.x = 0;
      virtualAxis.y = 0;
      padAxis.x = 0;
      padAxis.y = 0;
    },

    ACTIONS,
    KEY_MAP,
    DEFAULT_PAD_MAP
  };

  global.Input = Input;
})(window);

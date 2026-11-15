/**
 * game.js — As Quatro Chamas de Nzila
 * Arquivo principal: canvas, loop de jogo, entidades, pausa e integração dos módulos.
 *
 * Ordem de scripts (index.html):
 *   input.js -> touch.js -> player.js -> (combat.js, enemy.js, ui.js) -> game.js
 *
 * Integração futura (módulos opcionais, detectados automaticamente):
 *   window.Combat -> { update(dt, game), draw(ctx, game) }   (combat.js)
 *   window.Enemy  -> { update(dt, game), draw(ctx, game) }   (enemy.js: gerenciador de inimigos)
 *   window.UI     -> { update(dt, game), draw(ctx, game) }   (ui.js: HUD, menus)
 * Qualquer objeto com update/draw pode ser adicionado com Game.addSystem(sys)
 * e entidades ordenáveis por profundidade (y) com Game.addEntity(entity).
 */
(function (global) {
  'use strict';

  const LOGICAL_WIDTH = 960;   // resolução lógica do jogo (16:9)
  const LOGICAL_HEIGHT = 540;
  const STEP = 1 / 60;         // passo fixo de simulação (s)
  const MAX_FRAME = 0.1;       // limite de tempo por frame (evita "espiral da morte")
  const HORIZON_Y = 210;       // início da área jogável (chão)

  const Game = {
    canvas: null,
    ctx: null,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    state: 'playing',          // 'playing' | 'paused'
    time: 0,                   // tempo de jogo em segundos (não conta durante a pausa)
    player: null,
    entities: [],              // entidades com y / update(dt) / draw(ctx)
    systems: [],               // sistemas com update(dt, game) / draw(ctx, game)
    debug: false,

    /** Inicializa canvas, entrada, controles touch e Player. */
    init() {
      if (this.canvas) return;

      this.canvas = document.querySelector('#game') || document.querySelector('canvas');
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        document.body.appendChild(this.canvas);
      }
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.canvas.style.touchAction = 'none';
      this.ctx = this.canvas.getContext('2d');
      this.fitCanvas();
      global.addEventListener('resize', () => this.fitCanvas());
      global.addEventListener('orientationchange', () => setTimeout(() => this.fitCanvas(), 200));

      // Entrada: teclado + gamepad/arcade (Input) e botões na tela (Touch)
      global.Input.init();
      if (global.Touch) global.Touch.init();

      // Pausa: Esc ou P, ou ao perder visibilidade
      global.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
        if (e.code === 'F3') this.debug = !this.debug;
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.pause();
      });
      // Toque no canvas pausado retoma o jogo
      this.canvas.addEventListener('pointerdown', () => {
        if (this.state === 'paused') this.resume();
      });

      // Player no centro da tela
      this.player = new global.Player({
        x: this.width / 2,
        y: this.height / 2,
        bounds: { width: this.width, height: this.height }
      });
      this.addEntity(this.player);

      // Módulos futuros (registrados se existirem)
      ['Combat', 'Enemy', 'UI'].forEach((name) => {
        const sys = global[name];
        if (sys && typeof sys === 'object') {
          if (typeof sys.init === 'function') sys.init(this);
          this.addSystem(sys);
        }
      });

      this.start();
    },

    /** Mantém proporção 16:9 e centraliza (letterbox) em qualquer tela. */
    fitCanvas() {
      const scale = Math.min(global.innerWidth / this.width, global.innerHeight / this.height);
      this.canvas.style.width = Math.floor(this.width * scale) + 'px';
      this.canvas.style.height = Math.floor(this.height * scale) + 'px';
    },

    addEntity(entity) {
      if (this.entities.indexOf(entity) === -1) this.entities.push(entity);
      return entity;
    },

    removeEntity(entity) {
      const i = this.entities.indexOf(entity);
      if (i !== -1) this.entities.splice(i, 1);
    },

    addSystem(system) {
      if (this.systems.indexOf(system) === -1) this.systems.push(system);
      return system;
    },

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      global.Input.reset();
    },

    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this._last = performance.now(); // evita salto de tempo ao retomar
    },

    togglePause() {
      if (this.state === 'playing') this.pause();
      else this.resume();
    },

    /** Inicia o loop principal (requestAnimationFrame + passo fixo). */
    start() {
      let acc = 0;
      this._last = performance.now();

      const frame = (now) => {
        const dt = Math.min((now - this._last) / 1000, MAX_FRAME);
        this._last = now;

        if (this.state === 'playing') {
          acc += dt;
          while (acc >= STEP) {
            this.update(STEP);
            acc -= STEP;
          }
        }
        this.draw();

        // Limpa eventos "pressionado/solto neste frame" (essencial para wasPressed)
        global.Input.endFrame();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },

    /** Lógica por passo fixo. */
    update(dt) {
      this.time += dt;

      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (typeof e.update === 'function') e.update(dt, this);
      }
      for (let i = 0; i < this.systems.length; i++) {
        const s = this.systems[i];
        if (typeof s.update === 'function') s.update(dt, this);
      }
    },

    /** Renderização. */
    draw() {
      const ctx = this.ctx;
      this.drawBackground(ctx);

      // Entidades ordenadas por profundidade (y maior = mais à frente)
      const sorted = this.entities.slice().sort((a, b) => a.y - b.y);
      for (let i = 0; i < sorted.length; i++) {
        if (typeof sorted[i].draw === 'function') sorted[i].draw(ctx, this);
      }

      for (let i = 0; i < this.systems.length; i++) {
        const s = this.systems[i];
        if (typeof s.draw === 'function') s.draw(ctx, this);
      }

      if (!global.UI) this.drawFallbackHUD(ctx); // some quando ui.js existir
      if (this.debug) this.drawDebug(ctx);
      if (this.state === 'paused') this.drawPause(ctx);
    },

    /** Cenário provisório: céu, chão e grade de referência. */
    drawBackground(ctx) {
      const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
      sky.addColorStop(0, '#2b1b3d');
      sky.addColorStop(1, '#e07a3f');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, this.width, HORIZON_Y);

      ctx.fillStyle = '#6f4527';
      ctx.fillRect(0, HORIZON_Y, this.width, this.height - HORIZON_Y);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= this.width; x += 60) { ctx.moveTo(x, HORIZON_Y); ctx.lineTo(x, this.height); }
      for (let y = HORIZON_Y; y <= this.height; y += 60) { ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
      ctx.stroke();
    },

    /** HUD provisório (HP/Eco) até o ui.js assumir. */
    drawFallbackHUD(ctx) {
      const p = this.player;
      if (!p) return;
      const bar = (x, y, w, h, v, color) => {
        ctx.fillStyle = '#1c1420';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      };
      bar(20, 20, 220, 16, p.hp / p.maxHp, '#d8453a');
      bar(20, 42, 220, 12, p.eco / p.maxEco, '#3aa8e8');
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('HP ' + Math.ceil(p.hp), 248, 33);
      ctx.fillText('ECO ' + Math.ceil(p.eco), 248, 53);
    },

    drawDebug(ctx) {
      const p = this.player;
      ctx.fillStyle = '#0f0';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('x:' + p.x.toFixed(0) + ' y:' + p.y.toFixed(0) + ' run:' + p.isRunning +
        ' gamepad:' + (global.Input.hasGamepad() ? global.Input.getGamepadName().slice(0, 30) : 'não'), 20, this.height - 14);
      const b = p.getBounds();
      ctx.strokeStyle = '#0f0';
      ctx.strokeRect(b.x, b.y, b.width, b.height);
    },

    drawPause(ctx) {
      ctx.fillStyle = 'rgba(10, 6, 16, 0.75)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#ffd36b';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSADO', this.width / 2, this.height / 2 - 10);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.fillText('Toque na tela ou pressione P / Esc para continuar', this.width / 2, this.height / 2 + 24);
    }
  };

  // Definir window.Game ANTES do DOMContentLoaded desativa o demo embutido do player.js
  global.Game = Game;

  function boot() {
    if (!global.Input || !global.Player) {
      console.error('[Game] Carregue input.js e player.js antes de game.js.');
      return;
    }
    Game.init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

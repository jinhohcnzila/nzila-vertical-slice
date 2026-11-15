/**
 * player.js — As Quatro Chamas de Nzila
 * PATCH_COMBAT_FEEDBACK_V1
 *
 * Classe Player (Akin). Placeholder em retângulo vermelho, sem sprites.
 * Dependências: input.js (window.Input) carregado antes deste arquivo.
 * Ordem de scripts: input.js -> touch.js -> player.js -> ui.js -> game.js
 *
 * Convenção de coordenadas: x, y = centro do retângulo, em pixels do canvas.
 *
 * Feedback de combate:
 *   - Hitbox do ataque desenhada enquanto o golpe está ativo.
 *   - Efeito de swing (arco) ao atacar e de impacto no contato.
 *   - Aura azul ao usar Eco e leve aura de prontidão quando há Eco suficiente.
 *   - Buffer de entrada: o toque/tecla não se perde em frames sem passo de simulação.
 *
 * Integração futura (combat.js / enemy.js):
 *   player.registerHit(x, y)  -> dispara efeito de impacto na posição do alvo
 *   player.getAttackHitbox()  -> retângulo do golpe para colisão
 *   player.takeDamage(n) / player.gainEco(n)
 *   Hooks: onAttack(player, hitbox), onEco(player, cost), onDeath(player)
 */
(function (global) {
  'use strict';

  const DEFAULTS = Object.freeze({
    width: 32,
    height: 48,
    hp: 100,
    eco: 100,
    speed: 180,              // px/s caminhando
    runSpeed: 300,           // px/s correndo (Shift / analógico no limite)
    attackDuration: 0.18,    // s com hitbox ativa
    attackCooldown: 0.35,    // s entre ataques
    attackRange: 36,
    attackHeight: 28,
    ecoCost: 20,
    ecoRegen: 0,             // Eco por segundo (0 = sem regeneração)
    ecoUseCooldown: 0.45,    // s entre usos de Eco
    ecoAuraDuration: 0.9,    // s da aura azul após usar Eco
    inputBuffer: 0.14,       // s em que um pedido de ataque/Eco fica guardado
    color: '#d32f2f'
  });

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const MAX_FX = 40;

  class Player {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.x]
     * @param {number} [opts.y]
     * @param {{width:number,height:number}} [opts.bounds]
     * @param {Object} [opts.input]  padrão: window.Input
     */
    constructor(opts = {}) {
      const o = Object.assign({}, DEFAULTS, opts);

      this.input = o.input || global.Input;

      // Posição e dimensões
      this.x = typeof o.x === 'number' ? o.x : 0;
      this.y = typeof o.y === 'number' ? o.y : 0;
      this.width = o.width;
      this.height = o.height;
      this.bounds = o.bounds || null;

      // Atributos
      this.maxHp = o.hp;
      this.hp = o.hp;
      this.maxEco = o.eco;
      this.eco = o.eco;
      this.speed = o.speed;
      this.runSpeed = o.runSpeed;
      this.ecoCost = o.ecoCost;
      this.ecoRegen = o.ecoRegen;
      this.color = o.color;

      // Estado de movimento
      this.vx = 0;
      this.vy = 0;
      this.facing = 1;         // 1 = direita, -1 = esquerda
      this.isRunning = false;
      this.isMoving = false;
      this.age = 0;            // tempo de vida (s), usado em animações

      // Ataque
      this.attackDuration = o.attackDuration;
      this.attackCooldown = o.attackCooldown;
      this.attackRange = o.attackRange;
      this.attackHeight = o.attackHeight;
      this.attackTimer = 0;        // > 0 enquanto o golpe está ativo
      this.cooldownTimer = 0;      // > 0 enquanto não pode atacar
      this.attackId = 0;           // incrementa a cada golpe (evita multi-hit)
      this.attackImpactDone = false;

      // Eco
      this.ecoUseCooldown = o.ecoUseCooldown;
      this.ecoAuraDuration = o.ecoAuraDuration;
      this.ecoCooldown = 0;        // > 0 enquanto não pode usar Eco
      this.ecoAuraT = 0;           // > 0 enquanto a aura azul está visível
      this.ecoTimer = 0;           // feedback curto (compatibilidade)
      this.ecoSpentAmount = 0;     // último valor gasto
      this.ecoSpentId = 0;         // incrementa a cada gasto (UI detecta a mudança)

      // Buffer de entrada
      this.inputBuffer = o.inputBuffer;
      this.attackBuffer = 0;
      this.ecoBuffer = 0;
      this._atkLatch = false;
      this._ecoLatch = false;

      // Efeitos temporários
      this.fx = [];

      // Hooks para integração futura
      this.onAttack = null;        // (player, hitbox) => void
      this.onEco = null;           // (player, cost) => void
      this.onDeath = null;         // (player) => void
    }

    /* ----------------------------- Estado ----------------------------- */

    get isAlive() {
      return this.hp > 0;
    }

    get isAttacking() {
      return this.attackTimer > 0;
    }

    get isEcoActive() {
      return this.ecoAuraT > 0;
    }

    /** Fração do cooldown de ataque restante (0 = pronto, 1 = acabou de atacar). */
    get attackCooldownRatio() {
      return this.attackCooldown > 0 ? clamp01(this.cooldownTimer / this.attackCooldown) : 0;
    }

    /** Fração do cooldown de Eco restante (0 = pronto). */
    get ecoCooldownRatio() {
      return this.ecoUseCooldown > 0 ? clamp01(this.ecoCooldown / this.ecoUseCooldown) : 0;
    }

    get canUseEco() {
      return this.isAlive && this.ecoCooldown <= 0 && this.eco >= this.ecoCost;
    }

    /* ----------------------------- Update ----------------------------- */

    /**
     * Atualização por passo de simulação.
     * @param {number} dt segundos
     */
    update(dt) {
      if (!this.isAlive) {
        this.vx = this.vy = 0;
        this.fx.length = 0;
        return;
      }
      dt = Math.min(Math.max(dt || 0, 0), 0.05);
      this.age += dt;

      // Timers
      if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - dt);
      if (this.cooldownTimer > 0) this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
      if (this.ecoTimer > 0) this.ecoTimer = Math.max(0, this.ecoTimer - dt);
      if (this.ecoAuraT > 0) this.ecoAuraT = Math.max(0, this.ecoAuraT - dt);
      if (this.ecoCooldown > 0) this.ecoCooldown = Math.max(0, this.ecoCooldown - dt);
      if (this.attackBuffer > 0) this.attackBuffer = Math.max(0, this.attackBuffer - dt);
      if (this.ecoBuffer > 0) this.ecoBuffer = Math.max(0, this.ecoBuffer - dt);
      if (this.ecoRegen > 0 && this.eco < this.maxEco) {
        this.eco = Math.min(this.maxEco, this.eco + this.ecoRegen * dt);
      }

      // Golpe: impacto no meio da animação
      if (this.attackTimer > 0 && !this.attackImpactDone && this.attackTimer <= this.attackDuration * 0.5) {
        this.attackImpactDone = true;
        const h = this.getAttackHitbox();
        this.registerHit(h.x + h.width / 2, h.y + h.height / 2);
      }

      // Entrada com buffer: captura a borda de pressionar uma única vez por toque
      if (this.input) {
        const atk = this.input.wasPressed('attack');
        if (atk && !this._atkLatch) { this._atkLatch = true; this.attackBuffer = this.inputBuffer; }
        else if (!atk) this._atkLatch = false;

        const eco = this.input.wasPressed('eco');
        if (eco && !this._ecoLatch) { this._ecoLatch = true; this.ecoBuffer = this.inputBuffer; }
        else if (!eco) this._ecoLatch = false;
      }
      if (this.attackBuffer > 0 && this.attack()) this.attackBuffer = 0;
      if (this.ecoBuffer > 0 && this.useEco()) this.ecoBuffer = 0;

      this.move(dt);
      this.updateFx(dt);
    }

    /**
     * Movimento em 8 direções com diagonal normalizada e corrida (Shift).
     * @param {number} dt segundos
     */
    move(dt) {
      let ax = 0;
      let ay = 0;
      if (this.input) {
        const axis = this.input.getAxis();
        ax = axis.x;
        ay = axis.y;
        this.isRunning = this.input.isDown('run');
      }

      // Normalização das diagonais (magnitude máxima 1)
      const len = Math.hypot(ax, ay);
      if (len > 1) {
        ax /= len;
        ay /= len;
      }

      const speed = this.isRunning ? this.runSpeed : this.speed;
      this.vx = ax * speed;
      this.vy = ay * speed;
      this.isMoving = len > 0;

      if (ax > 0) this.facing = 1;
      else if (ax < 0) this.facing = -1;

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.clampToBounds();
    }

    clampToBounds() {
      if (!this.bounds) return;
      const hw = this.width / 2;
      const hh = this.height / 2;
      this.x = Math.max(hw, Math.min(this.bounds.width - hw, this.x));
      this.y = Math.max(hh, Math.min(this.bounds.height - hh, this.y));
    }

    /* ----------------------------- Ações ------------------------------ */

    /**
     * Inicia um ataque (J / ATQ). Respeita cooldown.
     * @returns {boolean} true se o golpe começou
     */
    attack() {
      if (!this.isAlive || this.cooldownTimer > 0 || this.attackTimer > 0) return false;
      this.attackTimer = this.attackDuration;
      this.cooldownTimer = this.attackCooldown;
      this.attackImpactDone = false;
      this.attackId++;

      this.spawnFx({
        type: 'swing',
        x: this.x + this.facing * (this.width / 2 + this.attackRange * 0.4),
        y: this.y - 6,
        face: this.facing,
        life: this.attackDuration,
        max: this.attackDuration
      });

      const hitbox = this.getAttackHitbox();
      if (typeof this.onAttack === 'function') this.onAttack(this, hitbox);
      return true;
    }

    /**
     * Usa Eco (L / ECO). Consome o custo, dispara aura azul e cooldown.
     * @param {number} [cost]
     * @returns {boolean} true se o Eco foi consumido
     */
    useEco(cost = this.ecoCost) {
      if (!this.isAlive || cost <= 0 || this.eco < cost || this.ecoCooldown > 0) return false;
      this.eco -= cost;
      this.ecoTimer = 0.3;
      this.ecoCooldown = this.ecoUseCooldown;
      this.ecoAuraT = this.ecoAuraDuration;
      this.ecoSpentAmount = cost;
      this.ecoSpentId++;

      this.spawnFx({ type: 'eco', x: this.x, y: this.y - 8, life: 0.45, max: 0.45 });
      if (typeof this.onEco === 'function') this.onEco(this, cost);
      return true;
    }

    /**
     * Efeito de impacto em uma posição (chamado no contato com o golpe).
     * combat.js pode chamar com a posição do alvo atingido.
     */
    registerHit(x, y) {
      const px = typeof x === 'number' ? x : this.x + this.facing * (this.width / 2 + this.attackRange / 2);
      const py = typeof y === 'number' ? y : this.y - 8;
      this.spawnFx({ type: 'impact', x: px, y: py, life: 0.22, max: 0.22 });
    }

    gainEco(amount) {
      this.eco = Math.min(this.maxEco, Math.max(0, this.eco + amount));
    }

    takeDamage(amount) {
      if (!this.isAlive || amount <= 0) return 0;
      const before = this.hp;
      this.hp = Math.max(0, this.hp - amount);
      if (this.hp === 0 && typeof this.onDeath === 'function') this.onDeath(this);
      return before - this.hp;
    }

    heal(amount) {
      if (!this.isAlive) return;
      this.hp = Math.min(this.maxHp, this.hp + Math.max(0, amount));
    }

    /* ----------------------------- Geometria -------------------------- */

    /** Retângulo do corpo {x, y, width, height} (canto superior esquerdo). */
    getBounds() {
      return {
        x: this.x - this.width / 2,
        y: this.y - this.height / 2,
        width: this.width,
        height: this.height
      };
    }

    /** Hitbox do golpe (à frente do Player), mesmo formato de getBounds(). */
    getAttackHitbox() {
      const w = this.attackRange;
      const h = this.attackHeight;
      const left = this.facing === 1 ? this.x + this.width / 2 : this.x - this.width / 2 - w;
      return { x: left, y: this.y - h / 2, width: w, height: h };
    }

    /* ----------------------------- Efeitos ---------------------------- */

    spawnFx(fx) {
      fx.max = fx.max || fx.life;
      this.fx.push(fx);
      if (this.fx.length > MAX_FX) this.fx.shift();
    }

    updateFx(dt) {
      for (let i = this.fx.length - 1; i >= 0; i--) {
        this.fx[i].life -= dt;
        if (this.fx[i].life <= 0) this.fx.splice(i, 1);
      }
    }

    /* ----------------------------- Desenho ---------------------------- */

    /**
     * Desenha o Player, aura, hitbox e efeitos.
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
      const b = this.getBounds();

      // Sombra
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(this.x, b.y + b.height, this.width * 0.6, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Aura de Eco (atrás do corpo)
      this.drawEcoAura(ctx, b);

      // Corpo
      ctx.fillStyle = this.isAlive ? this.color : '#555';
      ctx.fillRect(b.x, b.y, b.width, b.height);

      // Olho (direção)
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x + this.facing * 6 - 2, b.y + 10, 4, 4);

      // Hitbox do golpe
      if (this.isAttacking) this.drawAttackHitbox(ctx);

      // Efeitos temporários
      this.drawFx(ctx);
    }

    drawEcoAura(ctx, b) {
      let a = 0;
      let strong = false;
      if (this.ecoAuraT > 0) {
        a = clamp01(this.ecoAuraT / this.ecoAuraDuration);
        strong = true;
      } else if (this.isAlive && this.eco >= this.ecoCost) {
        a = 0.2 + 0.08 * Math.sin(this.age * 4); // prontidão: aura suave pulsando
      }
      if (a <= 0) return;

      ctx.save();
      ctx.fillStyle = 'rgba(80, 200, 255, ' + (a * 0.3).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 4, b.width * 0.9 + 10 * a, b.height * 0.62 + 10 * a, 0, 0, Math.PI * 2);
      ctx.fill();
      if (strong) {
        ctx.strokeStyle = 'rgba(120, 220, 255, ' + (0.4 + 0.6 * a).toFixed(2) + ')';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12);
      }
      ctx.restore();
    }

    drawAttackHitbox(ctx) {
      const h = this.getAttackHitbox();
      const k = clamp01(this.attackTimer / this.attackDuration);
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.2 + 0.3 * k).toFixed(2) + ')';
      ctx.fillRect(h.x, h.y, h.width, h.height);
      ctx.strokeStyle = '#ffd36b';
      ctx.lineWidth = 2;
      ctx.strokeRect(h.x, h.y, h.width, h.height);
      ctx.restore();
    }

    drawFx(ctx) {
      for (let i = 0; i < this.fx.length; i++) {
        const f = this.fx[i];
        const t = clamp01(1 - f.life / f.max);
        const a = clamp01(1 - t);
        ctx.save();

        if (f.type === 'swing') {
          const dir = f.face > 0 ? 0 : Math.PI;
          ctx.strokeStyle = 'rgba(255, 255, 255, ' + (a * 0.9).toFixed(2) + ')';
          ctx.lineWidth = 2 + 4 * a;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 22 + 26 * t, dir - 1.0, dir + 1.0);
          ctx.stroke();
        } else if (f.type === 'impact') {
          ctx.strokeStyle = 'rgba(255, 220, 120, ' + a.toFixed(2) + ')';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const ang = k * Math.PI / 3 + t;
            ctx.moveTo(f.x + Math.cos(ang) * 6, f.y + Math.sin(ang) * 6);
            ctx.lineTo(f.x + Math.cos(ang) * (8 + 20 * t), f.y + Math.sin(ang) * (8 + 20 * t));
          }
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, ' + (a * 0.85).toFixed(2) + ')';
          ctx.beginPath();
          ctx.arc(f.x, f.y, 2 + 10 * a, 0, Math.PI * 2);
          ctx.fill();
        } else if (f.type === 'eco') {
          ctx.strokeStyle = 'rgba(80, 200, 255, ' + a.toFixed(2) + ')';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 12 + 46 * t, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(200, 240, 255, ' + (a * 0.7).toFixed(2) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 6 + 28 * t, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }
    }
  }

  global.Player = Player;

  /* ------------------------------------------------------------------
   * Demo de fallback: só roda se window.Game não existir.
   * ------------------------------------------------------------------ */
  function demo() {
    if (global.Game) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || !global.Input) return;
    const ctx = canvas.getContext('2d');

    global.Input.init();
    const player = new Player({
      x: canvas.width / 2,
      y: canvas.height / 2,
      bounds: { width: canvas.width, height: canvas.height }
    });
    global.__demoPlayer = player;

    let last = performance.now();
    function frame(now) {
      const dt = (now - last) / 1000;
      last = now;
      player.update(dt);

      ctx.fillStyle = '#1b1320';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      player.draw(ctx);

      global.Input.endFrame();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demo);
  else demo();
})(window);
/**
 * player.js — As Quatro Chamas de Nzila
 * Classe Player (Akin). Retângulo vermelho como placeholder (sem sprites).
 *
 * Dependências: js/input.js (window.Input) carregado ANTES deste arquivo.
 * Ordem de scripts: input.js -> touch.js -> player.js (-> combat.js, enemy.js, ui.js, game.js)
 * Entradas suportadas (via Input): teclado, touch (touch.js) e gamepad/arcade USB OTG.
 *
 * Convenção de coordenadas: x, y = CENTRO do retângulo, em pixels do canvas.
 *
 * Integração futura:
 *   - game.js   -> cria o Player, chama player.update(dt) e player.draw(ctx) a cada frame
 *   - combat.js -> usa player.getAttackHitbox(), player.takeDamage(), callbacks onAttack/onEco
 *   - enemy.js  -> lê player.x / player.y / player.getBounds()
 *   - ui.js     -> lê player.hp / player.maxHp / player.eco / player.maxEco
 */
(function (global) {
  'use strict';

  const DEFAULTS = Object.freeze({
    width: 32,
    height: 48,
    hp: 100,
    eco: 100,
    speed: 180,        // px/s caminhando
    runSpeed: 300,     // px/s correndo (Shift)
    attackDuration: 0.18, // s com hitbox ativa
    attackCooldown: 0.35, // s entre ataques
    attackRange: 36,
    attackHeight: 28,
    ecoCost: 20,
    ecoRegen: 0,       // Eco por segundo (0 = sem regeneração passiva)
    color: '#d32f2f'
  });

  class Player {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.x]       posição inicial X (centro)
     * @param {number} [opts.y]       posição inicial Y (centro)
     * @param {{width:number,height:number}} [opts.bounds] limites de movimento (normalmente o canvas)
     * @param {Object} [opts.input]   módulo de entrada (padrão: window.Input)
     */
    constructor(opts = {}) {
      const o = Object.assign({}, DEFAULTS, opts);

      this.input = o.input || global.Input;

      // --- Posição e dimensões ---
      this.x = typeof o.x === 'number' ? o.x : 0;
      this.y = typeof o.y === 'number' ? o.y : 0;
      this.width = o.width;
      this.height = o.height;
      this.bounds = o.bounds || null;

      // --- Atributos ---
      this.maxHp = o.hp;
      this.hp = o.hp;
      this.maxEco = o.eco;
      this.eco = o.eco;
      this.speed = o.speed;
      this.runSpeed = o.runSpeed;
      this.ecoCost = o.ecoCost;
      this.ecoRegen = o.ecoRegen;
      this.color = o.color;

      // --- Estado ---
      this.vx = 0;
      this.vy = 0;
      this.facing = 1;          // 1 = direita, -1 = esquerda
      this.isRunning = false;
      this.isMoving = false;

      // --- Ataque ---
      this.attackDuration = o.attackDuration;
      this.attackCooldown = o.attackCooldown;
      this.attackRange = o.attackRange;
      this.attackHeight = o.attackHeight;
      this.attackTimer = 0;     // > 0 enquanto o golpe está ativo
      this.cooldownTimer = 0;   // > 0 enquanto não pode atacar de novo
      this.attackId = 0;        // incrementa a cada golpe (evita multi-hit no combat.js)

      // --- Eco ---
      this.ecoTimer = 0;        // feedback visual do uso de Eco

      // --- Hooks para integração futura (combat.js / ui.js) ---
      this.onAttack = null;     // (player, hitbox) => void
      this.onEco = null;        // (player, cost) => void
      this.onDeath = null;      // (player) => void
    }

    /** Ainda vivo? */
    get isAlive() {
      return this.hp > 0;
    }

    /** Está com a hitbox de ataque ativa? */
    get isAttacking() {
      return this.attackTimer > 0;
    }

    /**
     * Atualização por frame.
     * @param {number} dt delta time em SEGUNDOS
     */
    update(dt) {
      if (!this.isAlive) {
        this.vx = this.vy = 0;
        return;
      }
      dt = Math.min(Math.max(dt || 0, 0), 0.05); // protege contra saltos de tempo (aba em segundo plano)

      // Timers
      if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - dt);
      if (this.cooldownTimer > 0) this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
      if (this.ecoTimer > 0) this.ecoTimer = Math.max(0, this.ecoTimer - dt);
      if (this.ecoRegen > 0 && this.eco < this.maxEco) {
        this.eco = Math.min(this.maxEco, this.eco + this.ecoRegen * dt);
      }

      // Ações por evento (um disparo por pressionar)
      if (this.input) {
        if (this.input.wasPressed('attack')) this.attack();
        if (this.input.wasPressed('eco')) this.useEco();
      }

      this.move(dt);
    }

    /**
     * Movimento em 8 direções com diagonal normalizada e corrida (Shift).
     * @param {number} dt delta time em segundos
     */
    move(dt) {
      let ax = 0;
      let ay = 0;
      if (this.input) {
        const axis = this.input.getAxis();
        ax = axis.x;
        ay = axis.y;
        this.isRunning = this.input.isDown('run');
      }

      // Normalização: evita velocidade ~41% maior nas diagonais.
      // Mantém magnitude < 1 (analógico virtual) e limita a 1.
      const len = Math.hypot(ax, ay);
      if (len > 1) {
        ax /= len;
        ay /= len;
      }

      const speed = this.isRunning ? this.runSpeed : this.speed;
      this.vx = ax * speed;
      this.vy = ay * speed;
      this.isMoving = len > 0;

      if (ax > 0) this.facing = 1;
      else if (ax < 0) this.facing = -1;

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      this.clampToBounds();
    }

    /** Mantém o Player dentro dos limites (bounds). */
    clampToBounds() {
      if (!this.bounds) return;
      const hw = this.width / 2;
      const hh = this.height / 2;
      this.x = Math.max(hw, Math.min(this.bounds.width - hw, this.x));
      this.y = Math.max(hh, Math.min(this.bounds.height - hh, this.y));
    }

    /**
     * Inicia um ataque básico (J). Respeita cooldown.
     * @returns {boolean} true se o golpe foi iniciado
     */
    attack() {
      if (!this.isAlive || this.cooldownTimer > 0 || this.attackTimer > 0) return false;
      this.attackTimer = this.attackDuration;
      this.cooldownTimer = this.attackCooldown;
      this.attackId++;
      if (typeof this.onAttack === 'function') this.onAttack(this, this.getAttackHitbox());
      return true;
    }

    /**
     * Usa Eco (L). Consome `cost` de Eco se houver o suficiente.
     * O efeito real (buff, habilidade) será tratado no combat.js via onEco.
     * @param {number} [cost] custo (padrão: this.ecoCost)
     * @returns {boolean} true se o Eco foi consumido
     */
    useEco(cost = this.ecoCost) {
      if (!this.isAlive || cost <= 0 || this.eco < cost) return false;
      this.eco -= cost;
      this.ecoTimer = 0.3;
      if (typeof this.onEco === 'function') this.onEco(this, cost);
      return true;
    }

    /** Ganha Eco (limitado ao máximo). */
    gainEco(amount) {
      this.eco = Math.min(this.maxEco, Math.max(0, this.eco + amount));
    }

    /** Recebe dano. Retorna o dano efetivamente aplicado. */
    takeDamage(amount) {
      if (!this.isAlive || amount <= 0) return 0;
      const before = this.hp;
      this.hp = Math.max(0, this.hp - amount);
      if (this.hp === 0 && typeof this.onDeath === 'function') this.onDeath(this);
      return before - this.hp;
    }

    /** Cura (limitada ao máximo). */
    heal(amount) {
      if (!this.isAlive) return;
      this.hp = Math.min(this.maxHp, this.hp + Math.max(0, amount));
    }

    /** Retângulo do corpo {x, y, width, height} (canto superior esquerdo) para colisões. */
    getBounds() {
      return {
        x: this.x - this.width / 2,
        y: this.y - this.height / 2,
        width: this.width,
        height: this.height
      };
    }

    /** Hitbox do ataque (frente do Player), no mesmo formato de getBounds(). */
    getAttackHitbox() {
      const w = this.attackRange;
      const h = this.attackHeight;
      const left = this.facing === 1 ? this.x + this.width / 2 : this.x - this.width / 2 - w;
      return { x: left, y: this.y - h / 2, width: w, height: h };
    }

    /**
     * Desenha o Player (retângulo vermelho).
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
      const b = this.getBounds();

      // Sombra
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(this.x, b.y + b.height, this.width * 0.6, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Corpo
      ctx.fillStyle = this.isAlive ? this.color : '#555';
      ctx.fillRect(b.x, b.y, b.width, b.height);

      // Indicador de direção (olho)
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x + this.facing * 6 - 2, b.y + 10, 4, 4);

      // Aura de Eco
      if (this.ecoTimer > 0) {
        ctx.strokeStyle = 'rgba(80, 200, 255, ' + (this.ecoTimer / 0.3).toFixed(2) + ')';
        ctx.lineWidth = 4;
        ctx.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
      }

      // Hitbox de ataque ativa (placeholder visual)
      if (this.isAttacking) {
        const h = this.getAttackHitbox();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(h.x, h.y, h.width, h.height);
      }
    }
  }

  global.Player = Player;

  /* ------------------------------------------------------------------
   * Bootstrap de demonstração
   * Se game.js ainda não existir (window.Game ausente), roda um loop
   * mínimo: Akin no centro do canvas, atualizado em tempo real.
   * Quando game.js for criado, basta definir window.Game e este bloco
   * é ignorado automaticamente.
   * ------------------------------------------------------------------ */
  function demo() {
    if (global.Game) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || !global.Input) return;
    const ctx = canvas.getContext('2d');

    global.Input.init();
    if (global.Touch) global.Touch.init();
    const player = new Player({
      x: canvas.width / 2,
      y: canvas.height / 2,
      bounds: { width: canvas.width, height: canvas.height }
    });
    global.__demoPlayer = player;

    let last = performance.now();
    function frame(now) {
      const dt = (now - last) / 1000;
      last = now;

      player.update(dt);

      ctx.fillStyle = '#1b1320';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      player.draw(ctx);

      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
      ctx.fillText('HP ' + Math.ceil(player.hp) + '  ECO ' + Math.ceil(player.eco), 12, 22);
      ctx.fillText(global.Input.hasGamepad() ? 'Gamepad: ' + global.Input.getGamepadName().slice(0, 40) : 'Gamepad: aperte um botão para detectar', 12, 42);

      global.Input.endFrame();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demo);
  else demo();
})(window);

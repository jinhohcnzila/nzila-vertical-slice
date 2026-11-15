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

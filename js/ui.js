/**
 * ui.js — As Quatro Chamas de Nzila
 * Interface em tela (HUD) desenhada no canvas: Vida, Eco, Groove, Combo,
 * barra de chefe, mensagens centrais e textos flutuantes.
 *
 * Integração:
 *   - Carregue ANTES de game.js. O Game detecta window.UI e o registra como sistema
 *     (chama UI.init(game), UI.update(dt, game) e UI.draw(ctx, game)); o HUD provisório
 *     do game.js é desativado automaticamente.
 *   - HP e Eco são lidos direto de game.player (hp, maxHp, eco, maxEco).
 *
 * API (window.UI) para combat.js / enemy.js / game.js:
 *   UI.showMessage(texto, segundos = 2.5)
 *   UI.addFloater(x, y, texto, cor = '#fff')       -> texto flutuante em coordenadas do mundo
 *   UI.setCombo(n)                                  -> contador de combo (0 esconde)
 *   UI.setGroove(ativo, restante = 0, total = 15)   -> barra/indicador de Groove
 *   UI.setBoss(nome, hp, maxHp) / UI.clearBoss()    -> barra de chefe
 *   UI.reset()                                      -> limpa estados temporários
 */
(function (global) {
  'use strict';

  const COLORS = Object.freeze({
    hp: '#d8453a',
    hpTrail: '#ffb0a0',
    eco: '#3aa8e8',
    ecoFlash: '#bdeaff',
    groove: '#ffcf4a',
    bg: '#1c1420',
    border: '#000',
    text: '#ffffff',
    accent: '#ffd36b'
  });

  const FONT = 'sans-serif';
  const COMBO_TIMEOUT = 2.5;   // s sem acertos até o combo sumir visualmente
  const TRAIL_DELAY = 0.35;    // s antes da barra de "dano recente" começar a descer
  const TRAIL_SPEED = 0.6;     // fração da barra por segundo

  const state = {
    game: null,
    time: 0,
    // Barras suavizadas (0..1)
    hpShown: 1, hpTrail: 1, trailWait: 0, lastHp: -1,
    ecoShown: 1, ecoFlash: 0, lastEco: -1,
    // Mensagem central
    message: '', messageT: 0, messageDur: 0,
    // Combo
    combo: 0, comboT: 0, comboPop: 0,
    // Groove
    groove: { active: false, remaining: 0, total: 15 },
    // Chefe
    boss: null,
    // Textos flutuantes
    floaters: []
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function bar(ctx, x, y, w, h, fill, color, bg) {
    ctx.fillStyle = bg || COLORS.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp01(fill), h);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function text(ctx, str, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'left';
    ctx.fillStyle = color || COLORS.text;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(str, x, y);   // contorno para leitura em qualquer fundo
    ctx.fillText(str, x, y);
  }

  const UI = {
    /** Chamado pelo Game ao registrar o sistema. */
    init(game) {
      state.game = game;
    },

    /** Atualiza animações do HUD. */
    update(dt, game) {
      const g = game || state.game;
      state.time += dt;
      const p = g && g.player;

      if (p) {
        const hp = clamp01(p.hp / p.maxHp);
        const eco = clamp01(p.eco / p.maxEco);

        // Vida: barra principal desce rápido; "rastro" de dano desce depois de um atraso
        if (state.lastHp >= 0 && p.hp < state.lastHp) state.trailWait = TRAIL_DELAY;
        state.lastHp = p.hp;
        state.hpShown += (hp - state.hpShown) * Math.min(1, dt * 14);
        if (hp > state.hpTrail) state.hpTrail = hp;
        else if (state.trailWait > 0) state.trailWait -= dt;
        else state.hpTrail = Math.max(hp, state.hpTrail - TRAIL_SPEED * dt);

        // Eco: pisca quando ganha/gasta
        if (state.lastEco >= 0 && Math.abs(p.eco - state.lastEco) > 0.01) state.ecoFlash = 0.25;
        state.lastEco = p.eco;
        state.ecoShown += (eco - state.ecoShown) * Math.min(1, dt * 12);
        if (state.ecoFlash > 0) state.ecoFlash = Math.max(0, state.ecoFlash - dt);
      }

      if (state.messageT > 0) state.messageT = Math.max(0, state.messageT - dt);

      if (state.combo > 0) {
        state.comboT -= dt;
        if (state.comboT <= 0) state.combo = 0;
      }
      if (state.comboPop > 0) state.comboPop = Math.max(0, state.comboPop - dt);

      if (state.groove.active) {
        state.groove.remaining = Math.max(0, state.groove.remaining - dt);
        if (state.groove.remaining <= 0) state.groove.active = false;
      }

      for (let i = state.floaters.length - 1; i >= 0; i--) {
        const f = state.floaters[i];
        f.life -= dt;
        f.y -= 32 * dt;
        if (f.life <= 0) state.floaters.splice(i, 1);
      }
    },

    /** Desenha o HUD em coordenadas de tela. */
    draw(ctx, game) {
      const g = game || state.game;
      if (!g) return;
      const W = g.width;
      const p = g.player;

      ctx.save();
      ctx.textBaseline = 'alphabetic';

      if (p) this.drawPlayerHud(ctx, p);
      this.drawCombo(ctx, W);
      this.drawBoss(ctx, W);
      this.drawFloaters(ctx, g);
      this.drawMessage(ctx, W, g.height);

      ctx.restore();
    },

    /** Nome, Vida, Eco e Groove (canto superior esquerdo). */
    drawPlayerHud(ctx, p) {
      const x = 20;
      const w = 240;

      text(ctx, 'AKIN', x, 22, 15, COLORS.accent);

      // Vida (com rastro de dano)
      const low = p.hp / p.maxHp <= 0.25 && p.hp > 0;
      const pulse = low ? 0.5 + 0.5 * Math.sin(state.time * 10) : 0;
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(x, 28, w, 18);
      ctx.fillStyle = COLORS.hpTrail;
      ctx.fillRect(x, 28, w * clamp01(state.hpTrail), 18);
      ctx.fillStyle = low ? 'rgb(' + Math.round(216 + 39 * pulse) + ',69,58)' : COLORS.hp;
      ctx.fillRect(x, 28, w * clamp01(state.hpShown), 18);
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 28, w, 18);
      text(ctx, Math.ceil(p.hp) + ' / ' + p.maxHp, x + w / 2, 42, 12, COLORS.text, 'center');

      // Eco (brilha ao mudar)
      const ecoColor = state.ecoFlash > 0 ? COLORS.ecoFlash : COLORS.eco;
      bar(ctx, x, 52, w, 14, state.ecoShown, ecoColor);
      text(ctx, 'ECO ' + Math.floor(p.eco), x + w / 2, 64, 11, COLORS.text, 'center');

      // Groove
      const gr = state.groove;
      bar(ctx, x, 72, w, 10, gr.active ? gr.remaining / gr.total : 0, COLORS.groove);
      text(ctx, gr.active ? 'GROOVE ' + gr.remaining.toFixed(1) + 's' : 'GROOVE', x + w + 10, 81, 11,
        gr.active ? COLORS.groove : 'rgba(255,255,255,0.55)');
    },

    /** Contador de combo (canto superior direito). */
    drawCombo(ctx, W) {
      if (state.combo < 2) return;
      const scale = 1 + state.comboPop * 1.5;
      ctx.save();
      ctx.translate(W - 24, 52);
      ctx.scale(scale, scale);
      text(ctx, state.combo + ' HITS', 0, 0, 32, COLORS.accent, 'right');
      ctx.restore();
      bar(ctx, W - 144, 60, 120, 5, state.comboT / COMBO_TIMEOUT, COLORS.accent);
    },

    /** Barra de chefe (topo, centralizada). */
    drawBoss(ctx, W) {
      const b = state.boss;
      if (!b) return;
      const w = 400;
      text(ctx, b.name, W / 2, 22, 15, '#f2e8c9', 'center');
      bar(ctx, W / 2 - w / 2, 28, w, 14, b.hp / b.maxHp, '#d8d0bb');
    },

    /** Textos flutuantes (coordenadas do mundo = coordenadas do canvas). */
    drawFloaters(ctx) {
      for (let i = 0; i < state.floaters.length; i++) {
        const f = state.floaters[i];
        ctx.globalAlpha = clamp01(f.life * 2);
        text(ctx, f.text, f.x, f.y, 16, f.color, 'center');
      }
      ctx.globalAlpha = 1;
    },

    /** Mensagem central temporária. */
    drawMessage(ctx, W, H) {
      if (state.messageT <= 0) return;
      const fadeIn = clamp01((state.messageDur - state.messageT) * 6);
      const fadeOut = clamp01(state.messageT * 2);
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);
      text(ctx, state.message, W / 2, H * 0.22, 24, COLORS.text, 'center');
      ctx.globalAlpha = 1;
    },

    /* ------------------------------ API ------------------------------ */

    showMessage(str, seconds) {
      state.message = String(str);
      state.messageDur = state.messageT = seconds > 0 ? seconds : 2.5;
    },

    addFloater(x, y, str, color) {
      state.floaters.push({ x, y, text: String(str), color: color || '#fff', life: 1 });
    },

    setCombo(n) {
      n = Math.max(0, n | 0);
      if (n > state.combo) state.comboPop = 0.12;
      state.combo = n;
      if (n > 0) state.comboT = COMBO_TIMEOUT;
    },

    setGroove(active, remaining, total) {
      state.groove.active = !!active;
      state.groove.total = total > 0 ? total : 15;
      state.groove.remaining = active ? Math.max(0, remaining || state.groove.total) : 0;
    },

    setBoss(name, hp, maxHp) {
      state.boss = { name: String(name), hp: Math.max(0, hp), maxHp: Math.max(1, maxHp) };
    },

    clearBoss() {
      state.boss = null;
    },

    reset() {
      state.message = '';
      state.messageT = 0;
      state.combo = 0;
      state.floaters.length = 0;
      state.boss = null;
      state.groove.active = false;
      state.hpShown = state.hpTrail = state.ecoShown = 1;
      state.lastHp = state.lastEco = -1;
    }
  };

  global.UI = UI;
})(window);

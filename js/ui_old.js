/**
 * ui.js — As Quatro Chamas de Nzila
 * PATCH_COMBAT_FEEDBACK_V1
 *
 * Interface desenhada no canvas + feedback nos botões touch:
 *   - HP (com rastro de dano) e Eco (com brilho e texto "-X ECO" ao gastar)
 *   - Barras de cooldown de ATQ e ECO (também para teclado/gamepad)
 *   - Cooldown visual nos botões ATQ e ECO da tela (overlay e brilho ao pressionar)
 *   - Debug: ATTACK ACTIVE / ECO ACTIVE (com F3 ou ?debug na URL)
 *   - Cronômetro, pausa, vitória e derrota
 *
 * Carregue ANTES de game.js. O Game chama:
 *   UI.init(game) | UI.update(dt, game) | UI.draw(ctx, game)
 *   UI.showResult(estado) | UI.reset() | UI.showMessage(texto, segundos)
 */
(function (global) {
  'use strict';

  const COLORS = Object.freeze({
    hp: '#d8453a',
    hpTrail: '#ffb0a0',
    eco: '#3aa8e8',
    ecoFlash: '#bdeaff',
    ecoSpent: '#7fd4ff',
    cooldown: '#ffd36b',
    bg: '#1c1420',
    border: '#000',
    text: '#ffffff',
    accent: '#ffd36b',
    on: '#7dffa0',
    off: '#6b6b7a',
    victory: '#7dffa0',
    defeat: '#ff5a4a'
  });

  const FONT = 'sans-serif';
  const TRAIL_DELAY = 0.35;
  const TRAIL_SPEED = 0.6;
  const DEBUG_QUERY = /[?&]debug/i;

  const state = {
    game: null,
    time: 0,
    // HP
    hpShown: 1, hpTrail: 1, trailWait: 0, lastHp: -1,
    // Eco
    ecoShown: 1, ecoFlash: 0, lastEco: -1, lastEcoSpentId: -1,
    // Textos flutuantes de Eco gasto
    floaters: [],
    // Mensagem temporária
    message: '', messageT: 0, messageDur: 0,
    // Resultado
    result: null, resultT: 0,
    // Botões touch
    btnAtk: null, btnEco: null
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /** CSS mínimo para o overlay de cooldown e o brilho dos botões touch. */
  function injectStyles() {
    if (document.getElementById('nz-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'nz-ui-style';
    style.textContent = [
      '.nz-btn { overflow: visible; }',
      '.nz-btn::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; pointer-events: none;',
      '  background: conic-gradient(rgba(0,0,0,0.62) var(--nz-cd, 0deg), transparent 0deg); }',
      '.nz-btn.on { box-shadow: 0 0 0 4px rgba(255,255,255,0.9), 0 0 22px 8px rgba(255,255,255,0.5); }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function findButtons() {
    if (!state.btnAtk) state.btnAtk = document.querySelector('.nz-atk');
    if (!state.btnEco) state.btnEco = document.querySelector('.nz-eco');
  }

  /** ratio 0..1 do tempo restante de cooldown -> overlay escuro no botão. */
  function setRing(el, ratio) {
    if (!el) return;
    el.style.setProperty('--nz-cd', (clamp01(ratio) * 360).toFixed(1) + 'deg');
  }

  function drawBar(ctx, x, y, w, h, fill, color) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp01(fill), h);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawText(ctx, str, x, y, size, color, align) {
    ctx.font = 'bold ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color || COLORS.text;
    ctx.fillText(str, x, y);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  const UI = {
    init(game) {
      state.game = game;
      injectStyles();
      this.reset();
    },

    /** Limpa estados temporários (nova partida). */
    reset() {
      state.hpShown = state.hpTrail = state.ecoShown = 1;
      state.trailWait = 0;
      state.lastHp = -1;
      state.lastEco = -1;
      state.lastEcoSpentId = -1;
      state.ecoFlash = 0;
      state.floaters.length = 0;
      state.message = '';
      state.messageT = 0;
      state.result = null;
      state.resultT = 0;
      setRing(state.btnAtk, 0);
      setRing(state.btnEco, 0);
    },

    /** Atualiza HP, Eco, cooldowns e animações. Roda em qualquer estado. */
    update(dt, game) {
      const g = game || state.game;
      state.time += dt;
      const p = g && g.player;
      findButtons();

      if (p) {
        const hp = clamp01(p.hp / p.maxHp);
        const eco = clamp01(p.eco / p.maxEco);

        // HP: barra principal + rastro de dano com atraso
        if (state.lastHp >= 0 && p.hp < state.lastHp) state.trailWait = TRAIL_DELAY;
        state.lastHp = p.hp;
        state.hpShown += (hp - state.hpShown) * Math.min(1, dt * 14);
        if (hp > state.hpTrail) state.hpTrail = hp;
        else if (state.trailWait > 0) state.trailWait -= dt;
        else state.hpTrail = Math.max(hp, state.hpTrail - TRAIL_SPEED * dt);

        // Eco gasto: flash + texto flutuante "-X ECO"
        if (p.ecoSpentId !== state.lastEcoSpentId) {
          if (state.lastEcoSpentId >= 0) {
            state.ecoFlash = 0.4;
            state.floaters.push({ text: '-' + p.ecoSpentAmount + ' ECO', life: 1, color: COLORS.ecoSpent });
          }
          state.lastEcoSpentId = p.ecoSpentId;
        }
        // Eco ganho: brilho
        if (state.lastEco >= 0 && p.eco > state.lastEco + 0.01) state.ecoFlash = Math.max(state.ecoFlash, 0.25);
        state.lastEco = p.eco;
        state.ecoShown += (eco - state.ecoShown) * Math.min(1, dt * 12);
        if (state.ecoFlash > 0) state.ecoFlash = Math.max(0, state.ecoFlash - dt);

        // Cooldown dos botões touch (overlay escuro = tempo restante)
        setRing(state.btnAtk, p.attackCooldownRatio);
        setRing(state.btnEco, p.ecoCooldown > 0 ? p.ecoCooldownRatio : 0);
        if (state.btnEco) state.btnEco.style.opacity = p.eco >= p.ecoCost ? '' : '0.45';
      }

      // Textos flutuantes
      for (let i = state.floaters.length - 1; i >= 0; i--) {
        const f = state.floaters[i];
        f.life -= dt;
        if (f.life <= 0) state.floaters.splice(i, 1);
      }

      if (state.messageT > 0) state.messageT = Math.max(0, state.messageT - dt);
      if (state.result) state.resultT += dt;
    },

    /** Desenha HUD, debug, mensagens e telas de fim de jogo. */
    draw(ctx, game) {
      const g = game || state.game;
      if (!g) return;
      ctx.save();

      if (g.player) {
        this.drawHud(ctx, g);
        if (g.debug || DEBUG_QUERY.test(global.location.search)) this.drawDebug(ctx, g);
      }
      this.drawMessage(ctx, g);

      if (g.state === g.STATE.PAUSED) this.drawPause(ctx, g);
      if (state.result) this.drawResult(ctx, g);

      ctx.restore();
    },

    /** HP, Eco, cooldowns e cronômetro. */
    drawHud(ctx, g) {
      const p = g.player;
      const x = 20;
      const w = 240;

      drawText(ctx, 'AKIN', x, 22, 15, COLORS.accent);

      // HP
      const low = p.hp > 0 && p.hp / p.maxHp <= 0.25;
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
      drawText(ctx, 'HP ' + Math.ceil(p.hp) + ' / ' + p.maxHp, x + w / 2, 42, 12, COLORS.text, 'center');

      // Eco (aura ativa = barra com brilho azul)
      const ecoColor = p.isEcoActive ? COLORS.ecoFlash : (state.ecoFlash > 0 ? COLORS.ecoFlash : COLORS.eco);
      drawBar(ctx, x, 52, w, 14, state.ecoShown, ecoColor);
      drawText(ctx, 'ECO ' + Math.floor(p.eco) + ' / ' + p.maxEco, x + w / 2, 64, 11, COLORS.text, 'center');

      // Textos "-X ECO" subindo a partir da barra
      for (let i = 0; i < state.floaters.length; i++) {
        const f = state.floaters[i];
        ctx.globalAlpha = clamp01(f.life * 2);
        drawText(ctx, f.text, x + w + 12, 66 - (1 - f.life) * 22, 14, f.color);
        ctx.globalAlpha = 1;
      }

      // Cooldowns (teclado / gamepad / touch)
      const atkReady = 1 - p.attackCooldownRatio;
      drawText(ctx, 'ATQ', x, 80, 10, 'rgba(255,255,255,0.75)');
      drawBar(ctx, x + 36, 71, w - 36, 6, atkReady, atkReady >= 1 ? COLORS.on : COLORS.cooldown);
      const ecoReady = p.ecoCooldown > 0 ? 1 - p.ecoCooldownRatio : (p.eco >= p.ecoCost ? 1 : 0);
      drawText(ctx, 'ECO', x, 92, 10, 'rgba(255,255,255,0.75)');
      drawBar(ctx, x + 36, 83, w - 36, 6, ecoReady, ecoReady >= 1 ? COLORS.on : COLORS.cooldown);

      // Cronômetro
      const urgent = g.state === g.STATE.PLAYING && g.timeLeft <= 5;
      drawText(ctx, formatTime(g.timeLeft), g.width - 24, 40, 32,
        urgent && Math.floor(state.time * 4) % 2 ? COLORS.defeat : COLORS.accent, 'right');
      drawText(ctx, 'SOBREVIVA', g.width - 24, 58, 12, 'rgba(255,255,255,0.7)', 'right');
    },

    /** Debug: ATTACK ACTIVE / ECO ACTIVE e valores dos timers. */
    drawDebug(ctx, g) {
      const p = g.player;
      const rows = [
        ['ATTACK ACTIVE', p.isAttacking, COLORS.on, COLORS.off, p.attackTimer.toFixed(2) + 's'],
        ['ECO ACTIVE', p.isEcoActive, COLORS.eco, COLORS.off, p.ecoAuraT.toFixed(2) + 's'],
        ['ATQ CD', p.cooldownTimer > 0, COLORS.cooldown, COLORS.off, p.cooldownTimer.toFixed(2) + 's'],
        ['ECO CD', p.ecoCooldown > 0, COLORS.cooldown, COLORS.off, p.ecoCooldown.toFixed(2) + 's']
      ];
      const x = 20;
      let y = 124;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 6, y - 16, 210, rows.length * 18 + 8);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        drawText(ctx, r[0] + ': ' + (r[1] ? 'ON' : 'off'), x, y, 12, r[1] ? r[2] : r[3]);
        drawText(ctx, r[4], x + 196, y, 12, 'rgba(255,255,255,0.7)', 'right');
        y += 18;
      }
      // Hitbox do ataque (vermelho/verde no espaço do jogo)
      if (p.isAttacking) {
        const h = p.getAttackHitbox();
        ctx.strokeStyle = COLORS.on;
        ctx.lineWidth = 2;
        ctx.strokeRect(h.x, h.y, h.width, h.height);
      }
    },

    /** Aviso temporário no topo central. */
    drawMessage(ctx, g) {
      if (state.messageT <= 0) return;
      const fadeIn = clamp01((state.messageDur - state.messageT) * 6);
      const fadeOut = clamp01(state.messageT * 2);
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);
      drawText(ctx, state.message, g.width / 2, g.height * 0.22, 24, COLORS.text, 'center');
      ctx.globalAlpha = 1;
    },

    drawPause(ctx, g) {
      ctx.fillStyle = 'rgba(10,6,16,0.75)';
      ctx.fillRect(0, 0, g.width, g.height);
      drawText(ctx, 'PAUSADO', g.width / 2, g.height / 2 - 10, 40, COLORS.accent, 'center');
      drawText(ctx, 'Toque na tela ou pressione P / Esc para continuar', g.width / 2, g.height / 2 + 24, 16, COLORS.text, 'center');
    },

    /** Mensagens de vitória / derrota. */
    drawResult(ctx, g) {
      const win = state.result === g.STATE.VICTORY;
      const t = clamp01(state.resultT * 2.5);
      const cx = g.width / 2;
      const cy = g.height / 2;

      ctx.globalAlpha = t * 0.8;
      ctx.fillStyle = win ? 'rgb(10,30,16)' : 'rgb(30,8,8)';
      ctx.fillRect(0, 0, g.width, g.height);

      ctx.globalAlpha = t;
      drawText(ctx, win ? 'VITÓRIA!' : 'DERROTA', cx, cy - 20, 56, win ? COLORS.victory : COLORS.defeat, 'center');
      drawText(ctx,
        win ? 'Akin sobreviveu 30 segundos. A chama de Nzila continua acesa.'
            : 'As chamas de Akin se apagaram...',
        cx, cy + 20, 18, COLORS.text, 'center');

      if (g.endTimer >= 0.8) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(state.time * 5);
        drawText(ctx, 'Toque na tela ou pressione Enter para jogar novamente', cx, cy + 66, 16, COLORS.accent, 'center');
      }
      ctx.globalAlpha = 1;
    },

    /** Chamado pelo Game ao terminar a partida. */
    showResult(result) {
      state.result = result;
      state.resultT = 0;
    },

    /** Aviso temporário. */
    showMessage(str, seconds) {
      state.message = String(str);
      state.messageDur = state.messageT = seconds > 0 ? seconds : 2.5;
    }
  };

  global.UI = UI;
})(window);
/**
 * ui.js — As Quatro Chamas de Nzila
 * Interface desenhada no canvas: HP, Eco, cronômetro, pausa e mensagens
 * de vitória/derrota.
 *
 * Carregue ANTES de game.js. O Game chama:
 *   UI.init(game)            -> uma vez, na inicialização
 *   UI.update(dt, game)      -> a cada frame (qualquer estado)
 *   UI.draw(ctx, game)       -> a cada frame, por cima da cena
 *   UI.showResult(estado)    -> ao terminar a partida ('victory' | 'defeat')
 *   UI.reset()               -> ao reiniciar a partida
 *
 * Extras: UI.showMessage(texto, segundos) para avisos temporários.
 */
(function (global) {
  'use strict';

  const COLORS = Object.freeze({
    hp: '#d8453a',
    hpTrail: '#ffb0a0',
    eco: '#3aa8e8',
    ecoFlash: '#bdeaff',
    bg: '#1c1420',
    border: '#000',
    text: '#ffffff',
    accent: '#ffd36b',
    victory: '#7dffa0',
    defeat: '#ff5a4a'
  });

  const FONT = 'sans-serif';
  const TRAIL_DELAY = 0.35;   // s antes do rastro de dano começar a descer
  const TRAIL_SPEED = 0.6;    // fração da barra por segundo

  const state = {
    game: null,
    time: 0,
    // HP
    hpShown: 1, hpTrail: 1, trailWait: 0, lastHp: -1,
    // Eco
    ecoShown: 1, ecoFlash: 0, lastEco: -1,
    // Mensagem temporária
    message: '', messageT: 0, messageDur: 0,
    // Tela de resultado
    result: null, resultT: 0
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function drawBar(ctx, x, y, w, h, fill, color) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp01(fill), h);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawText(ctx, str, x, y, size, color, align) {
    ctx.font = 'bold ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color || COLORS.text;
    ctx.fillText(str, x, y);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  const UI = {
    init(game) {
      state.game = game;
      this.reset();
    },

    /** Limpa estados temporários (nova partida). */
    reset() {
      state.hpShown = state.hpTrail = state.ecoShown = 1;
      state.trailWait = 0;
      state.lastHp = state.lastEco = -1;
      state.ecoFlash = 0;
      state.message = '';
      state.messageT = 0;
      state.result = null;
      state.resultT = 0;
    },

    /** Atualiza HP e Eco suavizados e animações. */
    update(dt, game) {
      const g = game || state.game;
      state.time += dt;
      const p = g && g.player;

      if (p) {
        const hp = clamp01(p.hp / p.maxHp);
        const eco = clamp01(p.eco / p.maxEco);

        // HP: barra principal desce rápido; rastro de dano desce com atraso
        if (state.lastHp >= 0 && p.hp < state.lastHp) state.trailWait = TRAIL_DELAY;
        state.lastHp = p.hp;
        state.hpShown += (hp - state.hpShown) * Math.min(1, dt * 14);
        if (hp > state.hpTrail) state.hpTrail = hp;
        else if (state.trailWait > 0) state.trailWait -= dt;
        else state.hpTrail = Math.max(hp, state.hpTrail - TRAIL_SPEED * dt);

        // Eco: brilha quando muda
        if (state.lastEco >= 0 && Math.abs(p.eco - state.lastEco) > 0.01) state.ecoFlash = 0.25;
        state.lastEco = p.eco;
        state.ecoShown += (eco - state.ecoShown) * Math.min(1, dt * 12);
        if (state.ecoFlash > 0) state.ecoFlash = Math.max(0, state.ecoFlash - dt);
      }

      if (state.messageT > 0) state.messageT = Math.max(0, state.messageT - dt);
      if (state.result) state.resultT += dt;
    },

    /** Desenha HUD, mensagens e telas de fim de jogo. */
    draw(ctx, game) {
      const g = game || state.game;
      if (!g) return;
      ctx.save();

      if (g.player) this.drawHud(ctx, g);
      this.drawMessage(ctx, g);

      if (g.state === g.STATE.PAUSED) this.drawPause(ctx, g);
      if (state.result) this.drawResult(ctx, g);

      ctx.restore();
    },

    /** HP, Eco e cronômetro. */
    drawHud(ctx, g) {
      const p = g.player;
      const x = 20;
      const w = 240;

      drawText(ctx, 'AKIN', x, 22, 15, COLORS.accent);

      // HP (rastro + pulso em vida baixa)
      const low = p.hp > 0 && p.hp / p.maxHp <= 0.25;
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
      drawText(ctx, 'HP ' + Math.ceil(p.hp) + ' / ' + p.maxHp, x + w / 2, 42, 12, COLORS.text, 'center');

      // Eco
      drawBar(ctx, x, 52, w, 14, state.ecoShown, state.ecoFlash > 0 ? COLORS.ecoFlash : COLORS.eco);
      drawText(ctx, 'ECO ' + Math.floor(p.eco) + ' / ' + p.maxEco, x + w / 2, 64, 11, COLORS.text, 'center');

      // Cronômetro (canto superior direito)
      const urgent = g.state === g.STATE.PLAYING && g.timeLeft <= 5;
      drawText(ctx, formatTime(g.timeLeft), g.width - 24, 40, 32,
        urgent && Math.floor(state.time * 4) % 2 ? COLORS.defeat : COLORS.accent, 'right');
      drawText(ctx, 'SOBREVIVA', g.width - 24, 58, 12, 'rgba(255,255,255,0.7)', 'right');
    },

    /** Aviso temporário no topo central. */
    drawMessage(ctx, g) {
      if (state.messageT <= 0) return;
      const fadeIn = clamp01((state.messageDur - state.messageT) * 6);
      const fadeOut = clamp01(state.messageT * 2);
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);
      drawText(ctx, state.message, g.width / 2, g.height * 0.22, 24, COLORS.text, 'center');
      ctx.globalAlpha = 1;
    },

    drawPause(ctx, g) {
      ctx.fillStyle = 'rgba(10,6,16,0.75)';
      ctx.fillRect(0, 0, g.width, g.height);
      drawText(ctx, 'PAUSADO', g.width / 2, g.height / 2 - 10, 40, COLORS.accent, 'center');
      drawText(ctx, 'Toque na tela ou pressione P / Esc para continuar', g.width / 2, g.height / 2 + 24, 16, COLORS.text, 'center');
    },

    /** Mensagens de vitória / derrota. */
    drawResult(ctx, g) {
      const win = state.result === g.STATE.VICTORY;
      const t = clamp01(state.resultT * 2.5); // fade-in

      ctx.globalAlpha = t * 0.8;
      ctx.fillStyle = win ? 'rgba(10,30,16,1)' : 'rgba(30,8,8,1)';
      ctx.fillRect(0, 0, g.width, g.height);

      ctx.globalAlpha = t;
      const cx = g.width / 2;
      const cy = g.height / 2;
      drawText(ctx, win ? 'VITÓRIA!' : 'DERROTA', cx, cy - 20, 56, win ? COLORS.victory : COLORS.defeat, 'center');
      drawText(ctx,
        win ? 'Akin sobreviveu 30 segundos. A chama de Nzila continua acesa.'
            : 'As chamas de Akin se apagaram...',
        cx, cy + 20, 18, COLORS.text, 'center');

      if (g.endTimer >= 0.8) {
        const blink = 0.55 + 0.45 * Math.sin(state.time * 5);
        ctx.globalAlpha = blink;
        drawText(ctx, 'Toque na tela ou pressione Enter para jogar novamente', cx, cy + 66, 16, COLORS.accent, 'center');
      }
      ctx.globalAlpha = 1;
    },

    /** Chamado pelo Game ao terminar a partida. */
    showResult(result) {
      state.result = result;
      state.resultT = 0;
    },

    /** Aviso temporário. */
    showMessage(str, seconds) {
      state.message = String(str);
      state.messageDur = state.messageT = seconds > 0 ? seconds : 2.5;
    }
  };

  global.UI = UI;
})(window);
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

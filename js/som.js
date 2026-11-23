/*
 * som.js — efeitos sonoros curtos, gerados na hora com Web Audio (sem arquivos).
 *
 *   pintar  → notinhas subindo (conquistou área)
 *   ops     → "uó-uó" descendo (pisou no próprio rastro / teve o rastro cortado)
 *   corte   → "tchic" (você cortou o rastro de alguém)
 *   virar   → um clique bem baixinho (mudou de direção)
 *   vitoria → fanfarra (fim de partida, você ganhou ou empatou no topo)
 *   fim     → fim de partida sem vitória (melodia amigável)
 *   clique  → botões dos menus
 *
 * Navegadores só deixam tocar som depois de um toque/tecla da pessoa: o áudio é
 * "destravado" no primeiro toque. O som pode ser desligado nas opções (⏸) e a
 * escolha fica salva no aparelho (IT.ui.opcoes.som).
 */
(function (IT) {
  'use strict';

  var ctx = null;
  var mestre = null;
  var VOLUME = 0.22;

  function contexto() {
    if (!ctx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      mestre = ctx.createGain();
      mestre.gain.value = VOLUME;
      mestre.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }

  function ligado() { return !IT.ui || !IT.ui.opcoes || IT.ui.opcoes.som !== false; }

  /* Uma nota: frequência (Hz), início (s a partir de agora), duração (s), forma da onda, volume. */
  function nota(freq, inicio, duracao, tipo, volume, freqFinal) {
    var c = ctx, t0 = c.currentTime + inicio;
    var osc = c.createOscillator(), env = c.createGain();
    osc.type = tipo || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (freqFinal) osc.frequency.exponentialRampToValueAtTime(freqFinal, t0 + duracao);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(volume || 1, t0 + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
    osc.connect(env); env.connect(mestre);
    osc.start(t0); osc.stop(t0 + duracao + 0.05);
  }

  var EFEITOS = {
    pintar: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { nota(f, i * 0.07, 0.16, 'triangle', 0.8); });
    },
    ops: function () {
      nota(392, 0, 0.18, 'square', 0.25, 330);
      nota(311, 0.18, 0.28, 'square', 0.25, 233);
    },
    corte: function () {
      nota(1400, 0, 0.06, 'square', 0.25, 700);
      nota(900, 0.06, 0.1, 'triangle', 0.5, 1800);
    },
    virar: function () {
      nota(880, 0, 0.035, 'sine', 0.18);
    },
    vitoria: function () {
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.52], [1047, 0.64]].forEach(function (n) {
        nota(n[0], n[1], 0.22, 'triangle', 0.9);
      });
    },
    fim: function () {
      [[659, 0], [587, 0.16], [523, 0.32], [659, 0.5]].forEach(function (n) { nota(n[0], n[1], 0.24, 'triangle', 0.7); });
    },
    clique: function () {
      nota(660, 0, 0.05, 'sine', 0.35);
    }
  };

  var ultimo = {};

  IT.som = {
    tocar: function (nome) {
      if (!ligado() || !EFEITOS[nome]) return;
      if (!contexto()) return;
      // Não empilha o mesmo som muitas vezes seguidas.
      var agora = ctx.currentTime;
      if (ultimo[nome] && agora - ultimo[nome] < 0.06) return;
      ultimo[nome] = agora;
      try { EFEITOS[nome](); } catch (e) { /* som é enfeite: nunca quebra o jogo */ }
    },

    /* Chamado no primeiro toque/tecla: destrava o áudio no iPhone/Chrome. */
    destravar: function () { if (ligado()) contexto(); },

    /* Usado nos testes: quantos sons tocaram (por nome). */
    contagem: {}
  };

  // Conta os sons (para os testes) sem mudar o comportamento.
  var tocarOriginal = IT.som.tocar;
  IT.som.tocar = function (nome) {
    IT.som.contagem[nome] = (IT.som.contagem[nome] || 0) + 1;
    tocarOriginal(nome);
  };

  ['pointerdown', 'keydown'].forEach(function (evento) {
    window.addEventListener(evento, function () { IT.som.destravar(); }, { capture: true, passive: true });
  });
})(window.IlhasDeTinta);

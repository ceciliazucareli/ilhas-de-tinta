/*
 * ui.js — interface em HTML por cima do canvas:
 * HUD (porcentagem e meta), mensagens rápidas, tela inicial e tela de vitória.
 */
(function (IT) {
  'use strict';

  var el = {};
  var timerMensagem = null;

  function $(id) { return document.getElementById(id); }

  IT.ui = {
    /* aoJogar é chamado pelos botões "Começar" e "Jogar de novo". */
    iniciar: function (aoJogar) {
      el.mensagem = $('mensagem');
      el.porcentagem = $('porcentagem');
      el.barra = $('barra-preenchida');
      el.marcaMeta = $('marca-meta');
      el.textoMeta = $('texto-meta');
      el.telaInicio = $('tela-inicio');
      el.telaVitoria = $('tela-vitoria');

      var meta = Math.round(IT.config.META * 100);
      el.textoMeta.textContent = 'Conquiste ' + meta + '% do mapa!';
      el.marcaMeta.style.left = meta + '%';

      $('botao-comecar').addEventListener('click', aoJogar);
      $('botao-jogar-de-novo').addEventListener('click', aoJogar);
    },

    /* Atualiza o HUD com a fração conquistada (0 a 1). */
    atualizarHUD: function (fracao) {
      var pct = Math.floor(fracao * 100);
      el.porcentagem.textContent = pct + '%';
      el.barra.style.width = Math.min(100, fracao * 100) + '%';
    },

    /* Mostra só a tela do estado atual: 'inicio', 'jogando' ou 'vitoria'. */
    mostrarEstado: function (estado) {
      el.telaInicio.hidden = estado !== 'inicio';
      el.telaVitoria.hidden = estado !== 'vitoria';
      var foco = estado === 'inicio' ? $('botao-comecar')
        : estado === 'vitoria' ? $('botao-jogar-de-novo') : null;
      if (foco) foco.focus();
    },

    /* Mostra um balão de mensagem por alguns segundos. */
    mostrarMensagem: function (texto, tipo) {
      el.mensagem.textContent = texto;
      el.mensagem.className = 'mensagem visivel ' + (tipo || '');
      clearTimeout(timerMensagem);
      timerMensagem = setTimeout(function () {
        el.mensagem.className = 'mensagem';
      }, 1600);
    },

    esconderMensagem: function () {
      clearTimeout(timerMensagem);
      el.mensagem.className = 'mensagem';
    }
  };
})(window.IlhasDeTinta);

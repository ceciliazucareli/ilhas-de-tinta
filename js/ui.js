/*
 * ui.js — interface em HTML por cima do canvas: mensagens rápidas.
 */
(function (IT) {
  'use strict';

  var el = {};
  var timerMensagem = null;

  IT.ui = {
    iniciar: function () {
      el.mensagem = document.getElementById('mensagem');
    },

    /* Mostra um balão de mensagem por alguns segundos. */
    mostrarMensagem: function (texto, tipo) {
      el.mensagem.textContent = texto;
      el.mensagem.className = 'mensagem visivel ' + (tipo || '');
      clearTimeout(timerMensagem);
      timerMensagem = setTimeout(function () {
        el.mensagem.className = 'mensagem';
      }, 1600);
    }
  };
})(window.IlhasDeTinta);

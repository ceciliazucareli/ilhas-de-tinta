/*
 * input.js — controles.
 * Teclado: setas ou WASD. Toque/mouse: botões direcionais na tela.
 * Cada direção pedida é repassada para a função "aoDirecionar".
 */
(function (IT) {
  'use strict';

  var TECLAS = {
    ArrowUp: 'cima', KeyW: 'cima',
    ArrowDown: 'baixo', KeyS: 'baixo',
    ArrowLeft: 'esquerda', KeyA: 'esquerda',
    ArrowRight: 'direita', KeyD: 'direita'
  };

  IT.input = {
    iniciar: function (aoDirecionar, aoConfirmar) {
      window.addEventListener('keydown', function (e) {
        var dir = TECLAS[e.code];
        if (dir) {
          e.preventDefault();
          aoDirecionar(dir);
        } else if ((e.code === 'Enter' || e.code === 'Space') && aoConfirmar) {
          if (aoConfirmar()) e.preventDefault();
        }
      });

      // Botões na tela: pointerdown responde rápido no toque e no mouse.
      var botoes = document.querySelectorAll('[data-direcao]');
      Array.prototype.forEach.call(botoes, function (botao) {
        botao.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          aoDirecionar(botao.getAttribute('data-direcao'));
        });
      });
    }
  };
})(window.IlhasDeTinta);

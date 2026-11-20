/*
 * input.js — controles.
 * Teclado: cada vaga de jogador tem um esquema (veja IT.CONTROLES em config.js).
 * Toque/mouse: botões direcionais na tela (esquema 'toque').
 * Cada direção pedida é repassada para aoDirecionar(esquema, direcao), onde
 * esquema é o índice da vaga (0 a 3) ou 'toque'. Quem decide qual jogador
 * recebe a direção é o game.js.
 */
(function (IT) {
  'use strict';

  /* Monta um mapa código-da-tecla → { esquema, direcao }. */
  function mapaDeTeclas() {
    var mapa = {};
    IT.CONTROLES.forEach(function (controle, esquema) {
      Object.keys(controle.teclas).forEach(function (codigo) {
        mapa[codigo] = { esquema: esquema, direcao: controle.teclas[codigo] };
      });
    });
    return mapa;
  }

  IT.input = {
    iniciar: function (aoDirecionar, aoConfirmar) {
      var mapa = mapaDeTeclas();

      window.addEventListener('keydown', function (e) {
        // Não atrapalha quem está digitando um nome na tela de configuração.
        var alvo = e.target && e.target.tagName;
        if (alvo === 'INPUT' || alvo === 'SELECT' || alvo === 'TEXTAREA') return;

        var tecla = mapa[e.code];
        if (tecla) {
          if (aoDirecionar(tecla.esquema, tecla.direcao)) e.preventDefault();
        } else if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') && aoConfirmar) {
          if (aoConfirmar()) e.preventDefault();
        }
      });

      // Botões na tela: pointerdown responde rápido no toque e no mouse.
      var botoes = document.querySelectorAll('[data-direcao]');
      Array.prototype.forEach.call(botoes, function (botao) {
        botao.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          aoDirecionar('toque', botao.getAttribute('data-direcao'));
        });
      });
    }
  };
})(window.IlhasDeTinta);

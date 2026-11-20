/*
 * game.js — liga tudo: cria grade e explorador, roda o loop com
 * requestAnimationFrame e aplica as regras quando o explorador chega numa célula.
 */
(function (IT) {
  'use strict';

  var C = IT.config;
  var jogo = {
    grade: null,
    explorador: null,
    ultimoTempo: 0
  };

  function novoJogo() {
    jogo.grade = new IT.Grade(C.COLUNAS, C.LINHAS);
    var cx = Math.floor(C.COLUNAS / 2), cy = Math.floor(C.LINHAS / 2);
    jogo.grade.pintarQuadrado(cx, cy, C.TERRITORIO_INICIAL);
    jogo.explorador = new IT.Explorador(cx, cy);
  }

  function quadro(agoraMs) {
    var agora = agoraMs / 1000;
    var dt = Math.min(0.05, agora - (jogo.ultimoTempo || agora)); // limita saltos
    jogo.ultimoTempo = agora;

    jogo.explorador.atualizar(dt, jogo.grade, null);
    IT.renderer.desenhar(jogo.grade, jogo.explorador, agora);
    requestAnimationFrame(quadro);
  }

  window.addEventListener('load', function () {
    novoJogo();
    IT.renderer.iniciar(document.getElementById('tela'), jogo.grade);
    IT.input.iniciar(function (dir) { jogo.explorador.pedirDirecao(dir); });
    requestAnimationFrame(quadro);
  });

  IT.jogo = jogo; // exposto para depuração no console
})(window.IlhasDeTinta);

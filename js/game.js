/*
 * game.js — liga tudo: cria grade e explorador, roda o loop com
 * requestAnimationFrame e aplica as regras quando o explorador chega numa célula.
 * Estados: 'inicio' → 'jogando' → 'vitoria' (e "Jogar de novo" volta a 'jogando').
 */
(function (IT) {
  'use strict';

  var C = IT.config;
  var jogo = {
    estado: 'inicio',
    grade: null,
    explorador: null,
    ultimoSeguro: null, // última célula de território visitada
    ultimoTempo: 0
  };

  function novoJogo() {
    jogo.grade = new IT.Grade(C.COLUNAS, C.LINHAS);
    var cx = Math.floor(C.COLUNAS / 2), cy = Math.floor(C.LINHAS / 2);
    jogo.grade.pintarQuadrado(cx, cy, C.TERRITORIO_INICIAL);
    jogo.explorador = new IT.Explorador(cx, cy);
    jogo.ultimoSeguro = { x: cx, y: cy };
    IT.renderer.novaPartida(jogo.grade);
  }

  /*
   * Regras aplicadas sempre que o explorador chega numa célula.
   * Devolve false quando o movimento deve ser interrompido.
   */
  function aoChegar(x, y) {
    var G = IT.Grade, grade = jogo.grade, v = grade.get(x, y);

    if (v === G.RASTRO) {
      // Pisou no próprio rastro: penalidade suave, sem "morte".
      grade.limparRastro();
      jogo.explorador.teleportar(jogo.ultimoSeguro.x, jogo.ultimoSeguro.y);
      jogo.explorador.travarMeiaVolta = false;
      IT.ui.mostrarMensagem('Ops! Tente de novo 🙂', 'aviso');
      return false;
    }

    if (v === G.VAZIO) {
      grade.set(x, y, G.RASTRO); // fora de casa: deixa tinta
      jogo.explorador.travarMeiaVolta = true;
      return true;
    }

    // Chegou no território.
    if (jogo.explorador.travarMeiaVolta) {
      var ganhas = grade.capturar();
      var fracao = grade.fracaoConquistada();
      IT.ui.atualizarHUD(fracao);
      if (fracao >= C.META) {
        vencer();
        return false;
      }
      if (ganhas > 0) IT.ui.mostrarMensagem('+' + ganhas + ' pedacinhos de ilha!', 'sucesso');
    }
    jogo.explorador.travarMeiaVolta = false;
    jogo.ultimoSeguro = { x: x, y: y };
    return true;
  }

  function vencer() {
    jogo.estado = 'vitoria';
    jogo.explorador.teleportar(jogo.explorador.x, jogo.explorador.y);
    IT.ui.esconderMensagem();
    IT.ui.mostrarEstado('vitoria');
    IT.renderer.soltarConfete();
  }

  /* Começa (ou recomeça) uma partida. */
  function jogar() {
    novoJogo();
    jogo.estado = 'jogando';
    IT.ui.atualizarHUD(jogo.grade.fracaoConquistada());
    IT.ui.mostrarEstado('jogando');
  }

  function quadro(agoraMs) {
    var agora = agoraMs / 1000;
    var dt = Math.min(0.05, agora - (jogo.ultimoTempo || agora)); // limita saltos
    jogo.ultimoTempo = agora;

    if (jogo.estado === 'jogando') {
      jogo.explorador.atualizar(dt, jogo.grade, aoChegar);
    }
    IT.renderer.desenhar(jogo.grade, jogo.explorador, agora);
    requestAnimationFrame(quadro);
  }

  window.addEventListener('load', function () {
    IT.renderer.iniciar(document.getElementById('tela'), new IT.Grade(C.COLUNAS, C.LINHAS));
    novoJogo();
    IT.ui.iniciar(jogar);
    IT.ui.atualizarHUD(jogo.grade.fracaoConquistada());
    IT.ui.mostrarEstado('inicio');
    IT.input.iniciar(
      function (dir) {
        if (jogo.estado === 'jogando') jogo.explorador.pedirDirecao(dir);
      },
      function () {
        // Enter/Espaço também começam o jogo nas telas de início e vitória.
        if (jogo.estado === 'jogando') return false;
        jogar();
        return true;
      }
    );
    requestAnimationFrame(quadro);
  });

  IT.jogo = jogo; // exposto para depuração no console
})(window.IlhasDeTinta);

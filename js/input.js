/*
 * input.js — controles.
 * Teclado: cada vaga de jogador tem um esquema (veja IT.CONTROLES em config.js).
 * Toque: DESLIZAR o dedo em qualquer lugar da tela (esquema 'toque'):
 *   - vale o eixo em que o dedo andou mais (só 4 direções, nada de diagonal);
 *   - responde durante o arrasto, assim que o dedo anda LIMIAR_PX, sem esperar soltar;
 *   - dá para virar várias vezes no mesmo arrasto: cada virada recomeça a
 *     medida a partir do ponto onde o dedo estava.
 *   (Arrastar com o mouse funciona igual.) As setas na tela são opcionais.
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

  var LIMIAR_PX = 24;

  function direcaoDoGesto(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'direita' : 'esquerda';
    return dy > 0 ? 'baixo' : 'cima';
  }

  /* Deslizar o dedo (ou arrastar o mouse) para mudar de direção. */
  function iniciarDeslizar(aoDirecionar, aoVirar) {
    var gesto = null; // { id, x, y, direcao }

    window.addEventListener('pointerdown', function (e) {
      if (!document.body.classList.contains('em-jogo')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, input, select, a, label')) return;
      gesto = { id: e.pointerId, x: e.clientX, y: e.clientY, direcao: null };
    });

    window.addEventListener('pointermove', function (e) {
      if (!gesto || e.pointerId !== gesto.id) return;
      var dx = e.clientX - gesto.x, dy = e.clientY - gesto.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < LIMIAR_PX) return;
      var direcao = direcaoDoGesto(dx, dy);
      if (direcao !== gesto.direcao) {
        if (aoDirecionar('toque', direcao)) {
          gesto.direcao = direcao;
          if (aoVirar) aoVirar(e.pointerType);
        }
      }
      // Recomeça a medida daqui: permite outra virada sem levantar o dedo.
      gesto.x = e.clientX;
      gesto.y = e.clientY;
    });

    function fim(e) { if (gesto && e.pointerId === gesto.id) gesto = null; }
    window.addEventListener('pointerup', fim);
    window.addEventListener('pointercancel', fim);

    // Durante a partida: sem rolagem, zoom de pinça, "puxar para atualizar"
    // ou menu de toque longo (listeners não passivos para poder impedir).
    function bloquear(e) {
      if (document.body.classList.contains('em-jogo') && !(e.target.closest && e.target.closest('button'))) {
        e.preventDefault();
      }
    }
    document.addEventListener('touchmove', bloquear, { passive: false });
    document.addEventListener('gesturestart', bloquear, { passive: false });
    document.addEventListener('contextmenu', function (e) {
      if (document.body.classList.contains('em-jogo')) e.preventDefault();
    });
  }

  IT.input = {
    LIMIAR_PX: LIMIAR_PX,

    /* aoVirar(tipoDePonteiro): chamado a cada virada feita deslizando. */
    iniciar: function (aoDirecionar, aoConfirmar, aoVirar) {
      var mapa = mapaDeTeclas();
      iniciarDeslizar(aoDirecionar, aoVirar);

      window.addEventListener('keydown', function (e) {
        // Não atrapalha quem está digitando um nome na tela de configuração.
        var alvo = e.target && e.target.tagName;
        if (alvo === 'INPUT' || alvo === 'SELECT' || alvo === 'TEXTAREA') return;

        var tecla = mapa[e.code];
        if (tecla) {
          // Segurar a tecla repete o evento ~30x/s: só a primeira vale (no online,
          // cada repetição viraria uma mensagem — issue #5).
          if (e.repeat) { if (document.body.classList.contains('em-jogo')) e.preventDefault(); return; }
          if (aoDirecionar(tecla.esquema, tecla.direcao)) e.preventDefault();
        } else if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') && aoConfirmar &&
                   alvo !== 'BUTTON') { // num botão focado, Enter/Espaço já clicam nele
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

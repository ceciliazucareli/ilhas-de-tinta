/*
 * assistir.js — modo oculto para ASSISTIR o robô campeão do algoritmo genético.
 *
 *   index.html?robo=campeao               → 1x1: robô campeão (J1, rosa) × CPU Impossível 😈
 *   index.html?robo=campeao&cenario=3j    → + CPU Difícil       (o campeão treinado para 3j)
 *   index.html?robo=campeao&cenario=4j    → + CPU Difícil + Médio
 *   index.html?robo=esperto               → o robô "esperto" fixo, para comparar
 *   ...&debug=1                           → mostra as decisões do robô (depurar-tela.js)
 *   index.html?debug=1                    → jogo normal pelo menu, mostrando as decisões
 *                                           da CPU (o Impossível, se houver; &quem=N escolhe)
 *
 * Só é carregado pelo game.js quando a URL tem ?robo= (nada aparece no menu).
 * O robô joga como uma pessoa: velocidade 1, só escolhe direções.
 * "Jogar de novo" começa outra partida com o mesmo robô.
 */
(function () {
  'use strict';
  var IT = window.IlhasDeTinta;
  var params = new URLSearchParams(location.search);
  var qual = params.get('robo');
  var cenario = params.get('cenario') || '1x1';
  var depurar = params.get('debug') === '1';

  function carregar(src, depois) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = depois;
    s.onerror = function () { console.error('assistir: não carregou ' + src); };
    document.body.appendChild(s);
  }

  // Carrega em sequência e depois começa.
  var lista = ['tests/genetico/robo.js', 'tests/genetico/casos.js', 'tests/genetico/resultados/campeoes.js'];
  if (!qual) lista = [];
  if (depurar) lista = lista.concat(['tests/genetico/depuracao.js', 'tests/genetico/depurar-tela.js']);
  (function proximo(i) {
    if (i < lista.length) { carregar(lista[i], function () { proximo(i + 1); }); return; }
    if (qual) comecar();
  })(0);

  var NOME = qual === 'campeao' ? 'Robô campeão' : 'Robô ' + qual;

  function ligar(jogador) {
    if (qual === 'campeao') {
      var campeoes = IT.campeoes || {}, c = campeoes[cenario];
      if (!c && campeoes['1x1']) {
        if (!jogador.avisouFalta) console.warn('assistir: ainda não há campeão para ' + cenario + '; usando o do 1x1');
        c = campeoes['1x1'];
      }
      jogador.avisouFalta = true;
      if (!c) { jogador.roboLigado = true; console.error('assistir: não há campeão treinado'); return; }
      IT.robo.ligar(jogador, IT.jogo, c.genes);
    } else {
      IT.robo.ligarPerfil(jogador, IT.jogo, qual);
    }
    jogador.roboLigado = true;
  }

  function comecar() {
    var vagas = [{ tipo: 'humano', cor: 'rosa', nome: NOME, dificuldade: 'medio' }]
      .concat(JSON.parse(JSON.stringify(window.CENARIOS_CONFERIR[cenario] || window.CENARIOS_CONFERIR['1x1'])));
    IT.jogo.jogar({ vagas: vagas });
    IT.ui.esconderDica(); // quem joga é o robô: a dica "deslize o dedo" só atrapalharia a vista
    // A cada partida nova ("Jogar de novo"), liga o robô no J1 de novo.
    (function vigiar() {
      var j = IT.jogo.jogadores[0];
      if (IT.jogo.estado === 'jogando' && j && j.nome === NOME && !j.roboLigado) { ligar(j); IT.ui.esconderDica(); }
      requestAnimationFrame(vigiar);
    })();
  }
})();

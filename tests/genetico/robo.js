/*
 * robo.js — "humano robô" parametrizado por genes, para o algoritmo genético.
 *
 * É um jogador HUMANO (velocidade 1, a de uma pessoa) que só escolhe a direção,
 * como o teclado — sem trapaça. Por baixo usa o "cérebro" das CPUs (js/ai.js):
 * planejamento de voltas em retângulo, volta segura para casa por BFS (nunca
 * pisa no próprio rastro), caça com previsão e "não deixar brecha". O que muda
 * de um robô para outro são os 14 genes (números de 0 a 1), traduzidos aqui em
 * parâmetros com significado.
 *
 * Roda igual no simulador (Node, tests/genetico/simulador.js) e no navegador
 * (index.html?robo=campeao). Não muda nada do jogo para quem joga.
 */
(function (IT) {
  'use strict';

  /* Cada gene: nome, faixa do valor real e o que significa. */
  var GENES = [
    { nome: 'profundidadeMax', min: 2, max: 10, inteiro: true, texto: 'quantas casas a volta avança para fora de casa (máximo)' },
    { nome: 'larguraMax', min: 2, max: 11, inteiro: true, texto: 'quantas casas a volta anda de lado (máximo)' },
    { nome: 'candidatos', min: 1, max: 10, inteiro: true, texto: 'quantas voltas compara antes de escolher' },
    { nome: 'rastroMax', min: 4, max: 40, inteiro: true, texto: 'rastro máximo antes de voltar para casa' },
    { nome: 'medo', min: 0, max: 10, inteiro: true, texto: 'distância de um adversário que faz voltar para casa (0 = ignora)' },
    { nome: 'margemSeguranca', min: -2, max: 6, inteiro: false, texto: 'volta se um adversário alcança meu rastro até N passos antes de eu chegar em casa' },
    { nome: 'alcanceCaca', min: 0, max: 20, inteiro: true, texto: 'até quantas casas vai cortar o rastro de um adversário (0 = não caça)' },
    { nome: 'respiro', min: 0, max: 6, inteiro: false, texto: 'segundos sem caçar depois de cortar alguém' },
    { nome: 'vigia', min: -1, max: 10, inteiro: true, texto: 'fica de olho no caminho de volta do adversário com rastro de até N (-1 = não vigia)' },
    { nome: 'pesoRoubo', min: 0, max: 4, inteiro: false, texto: 'quanto vale tomar território de adversário (1 = igual a grama)' },
    { nome: 'pesoBorda', min: -2, max: 2, inteiro: false, texto: 'preferência por voltas junto à borda do mapa (+) ou no meio (−)' },
    { nome: 'cautela', min: 0, max: 1, inteiro: false, texto: 'quanto desvaloriza uma volta com adversário perto (1 = descarta)' },
    { nome: 'esperaEmCasa', min: 0, max: 1.5, inteiro: false, texto: 'segundos em casa depois de pintar, antes de sair de novo' },
    { nome: 'raioPerigo', min: 0, max: 10, inteiro: false, texto: 'casas a mais em volta da volta planejada contadas como "perto"' }
  ];

  function decodificar(genes) {
    var p = {};
    GENES.forEach(function (g, i) {
      var v = Math.max(0, Math.min(1, genes[i]));
      var real = g.min + v * (g.max - g.min);
      p[g.nome] = g.inteiro ? Math.round(real) : real;
    });
    return p;
  }

  /* Liga o robô genético ao explorador do jogador (só escolhe direções). */
  function ligar(jogador, jogo, genes) {
    var p = decodificar(genes);
    var cerebro = IT.ia.criar(jogador, jogo);
    cerebro.nivel = {
      profundidade: [Math.max(1, p.profundidadeMax - 2), p.profundidadeMax],
      lado: [Math.max(2, p.larguraMax - 3), p.larguraMax],
      candidatos: p.candidatos,
      acaso: 0,
      seguro: true,                 // nunca pisa no próprio rastro por descuido
      rastroMax: p.rastroMax,
      medo: p.medo,
      caca: 0,
      estrategista: true,           // usa o motor de caça/perigo do ai.js com os genes abaixo
      alcance: p.alcanceCaca,
      respiro: p.respiro,
      folgaPerigo: p.margemSeguranca,
      vigiaMaxRastro: p.vigia
    };
    cerebro.parametros = p;

    // Nota de uma volta: grama vale 1, território de adversário vale pesoRoubo,
    // voltas junto à borda ganham bônus (pesoBorda) e adversário perto desvaloriza.
    cerebro.notaDoPlano = function (plano) {
      var grade = this.jogo.grade, id = this.jogador.id;
      var x0 = Math.min(plano.canto.x, plano.oposto.x), x1 = Math.max(plano.canto.x, plano.oposto.x);
      var y0 = Math.min(plano.canto.y, plano.oposto.y), y1 = Math.max(plano.canto.y, plano.oposto.y);
      var ganho = 0, area = 0;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var dono = grade.dono(x, y);
          area++;
          if (dono === 0) ganho += 1;
          else if (dono !== id) ganho += p.pesoRoubo;
        }
      }
      var distBorda = Math.min(x0, y0, grade.colunas - 1 - x1, grade.linhas - 1 - y1);
      var pertoDaBorda = Math.max(0, 1 - distBorda / 5);
      ganho += p.pesoBorda * area * (pertoDaBorda - 0.5);
      var perigo = this.adversarioMaisPerto(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
      var raio = (x1 - x0 + y1 - y0) / 2 + 3 + p.raioPerigo;
      if (perigo < raio) ganho *= (1 - p.cautela);
      return ganho;
    };

    // Espera um pouco em casa depois de pintar (fica andando dentro do território).
    var criarPlanoOriginal = cerebro.criarPlano;
    cerebro.criarPlano = function () {
      if (this.jogo.ultimoTempo < (this.esperaAte || 0)) { this.plano = []; this.modo = 'casa'; return; }
      criarPlanoOriginal.call(this);
    };
    var decidirOriginal = cerebro.decidir;
    cerebro.decidir = function () {
      var temRastro = this.jogo.grade.temRastro(this.jogador.id);
      if (this.tinhaRastro && !temRastro) this.esperaAte = this.jogo.ultimoTempo + p.esperaEmCasa;
      this.tinhaRastro = temRastro;
      decidirOriginal.call(this);
    };

    jogador.ia = cerebro;
    jogador.explorador.controlador = cerebro;
    jogador.explorador.velocidade = 1; // velocidade de uma pessoa
    return cerebro;
  }

  /* Perfis fixos para comparação (os mesmos "humanos robôs" de tests/simulacao.html). */
  var PERFIS = {
    esperto: { profundidade: [2, 3], lado: [2, 4], candidatos: 4, acaso: 0, seguro: true, rastroMax: 8, medo: 6, caca: 0 },
    cuidadoso: null // = nível Médio do ai.js
  };

  function ligarPerfil(jogador, jogo, perfil) {
    var cerebro = IT.ia.criar(jogador, jogo);
    cerebro.nivel = PERFIS[perfil] || IT.ia.NIVEIS.medio;
    jogador.ia = cerebro;
    jogador.explorador.controlador = cerebro;
    jogador.explorador.velocidade = 1;
    return cerebro;
  }

  IT.robo = { GENES: GENES, decodificar: decodificar, ligar: ligar, ligarPerfil: ligarPerfil };
})(window.IlhasDeTinta);

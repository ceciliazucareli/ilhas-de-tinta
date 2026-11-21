/*
 * game.js — liga tudo: cria a grade e os jogadores, roda o loop com
 * requestAnimationFrame e aplica as regras quando um explorador chega numa célula.
 *
 * Estados: 'configuracao' → 'jogando' → 'fim'
 *   - "Jogar de novo" recomeça com a mesma configuração;
 *   - "Mudar jogadores" volta para a tela de configuração.
 * Modos: 'solo' (1 jogador, meta de 80%, sem relógio) e 'multi' (2 a 4
 * jogadores, humanos e/ou CPU, com relógio e meta menor).
 */
(function (IT) {
  'use strict';

  var C = IT.config;

  /* Configuração usada quando ninguém mexeu na tela de configuração: o modo solo. */
  var CONFIGURACAO_SOLO = {
    vagas: [{ tipo: 'humano', cor: 'rosa', nome: 'Jogador 1', dificuldade: 'medio' }]
  };

  var jogo = {
    estado: 'configuracao',
    modo: 'solo',
    configuracao: CONFIGURACAO_SOLO,
    grade: null,
    jogadores: [],
    meta: C.META,
    tempoRestante: 0,
    ultimoTempo: 0     // tempo de jogo acumulado, em segundos (usado pela CPU)
  };

  /* ---------- Montagem da partida ---------- */

  /* Onde cada jogador começa: centro no solo; lados ou cantos com mais gente. */
  function posicoesIniciais(n, colunas, linhas) {
    var m = 4, dir = colunas - 1 - m, baixo = linhas - 1 - m;
    if (n === 1) return [{ x: Math.floor(colunas / 2), y: Math.floor(linhas / 2) }];
    if (n === 2) return [{ x: m, y: Math.floor(linhas / 2) }, { x: dir, y: Math.floor(linhas / 2) }];
    return [{ x: m, y: m }, { x: dir, y: baixo }, { x: dir, y: m }, { x: m, y: baixo }].slice(0, n);
  }

  function novaPartida(configuracao) {
    var vagas = configuracao.vagas;
    var n = vagas.length;
    var tam = C.TAMANHOS[n];

    jogo.configuracao = configuracao;
    jogo.modo = n === 1 ? 'solo' : 'multi';
    jogo.meta = n === 1 ? C.META : C.META_MULTI[n];
    jogo.tempoRestante = C.TEMPO_LIMITE;
    jogo.grade = new IT.Grade(tam.colunas, tam.linhas);

    var inicios = posicoesIniciais(n, tam.colunas, tam.linhas);
    jogo.jogadores = vagas.map(function (vaga, i) {
      var inicio = inicios[i];
      var j = {
        id: i + 1,               // valor gravado na grade
        slot: i,                 // vaga na configuração (define o teclado)
        nome: vaga.nome,
        corNome: vaga.cor,
        cor: IT.CORES_JOGADORES[vaga.cor],
        tipo: vaga.tipo,         // 'humano' ou 'cpu'
        dificuldade: vaga.dificuldade,
        inicio: inicio,
        ultimoSeguro: { x: inicio.x, y: inicio.y },
        explorador: new IT.Explorador(inicio.x, inicio.y),
        ia: null,
        // Contadores usados nos testes (ex.: a CPU nunca deve pisar no próprio rastro).
        estatisticas: { proprioRastro: 0, rastroCortado: 0, cortes: 0, capturas: 0 }
      };
      jogo.grade.pintarQuadrado(inicio.x, inicio.y, C.TERRITORIO_INICIAL, j.id);
      j.aoChegar = function (x, y) { return aoChegar(j, x, y); };
      return j;
    });

    // CPUs ganham um "cérebro" (ai.js) e a velocidade do nível escolhido.
    jogo.jogadores.forEach(function (j) {
      if (j.tipo === 'cpu' && IT.ia) {
        j.explorador.velocidade = IT.DIFICULDADES[j.dificuldade].velocidade;
        j.ia = IT.ia.criar(j, jogo);
        j.explorador.controlador = j.ia;
      }
    });

    IT.renderer.novaPartida(jogo.grade, jogo.jogadores);
  }

  function jogadorPorId(id) { return jogo.jogadores[id - 1]; }

  /* ---------- Regras ---------- */

  /*
   * Regras aplicadas sempre que o explorador do jogador "j" chega numa célula.
   * Devolve false quando o movimento dele deve ser interrompido.
   */
  function aoChegar(j, x, y) {
    var grade = jogo.grade;
    var rastro = grade.rastro(x, y);

    if (rastro === j.id) {
      // Pisou no próprio rastro: penalidade suave, sem "morte".
      j.estatisticas.proprioRastro++;
      penalizar(j, jogo.modo === 'solo' ? 'Ops! Tente de novo 🙂' : 'Ops, ' + j.nome + '! Tente de novo 🙂');
      return false;
    }

    if (rastro !== 0) {
      // Rastro de outro jogador: corta! (a não ser que ele esteja bem ali —
      // dois exploradores na mesma célula não faz nada acontecer).
      var outro = jogadorPorId(rastro);
      if (outro.explorador.x !== x || outro.explorador.y !== y) {
        j.estatisticas.cortes++;
        outro.estatisticas.rastroCortado++;
        penalizar(outro, '✂️ ' + j.nome + ' cortou o rastro de ' + outro.nome + '!');
      }
    }

    if (grade.dono(x, y) === j.id) {
      // De volta para casa: se havia rastro, conquista a área.
      if (grade.temRastro(j.id)) {
        var ganhas = grade.capturar(j.id);
        j.estatisticas.capturas++;
        darIlhaNovaParaQuemFicouSem();
        IT.ui.atualizarHUD(jogo);
        if (verificarFim()) return false;
        if (ganhas > 0) {
          avisar(jogo.modo === 'solo'
            ? '+' + ganhas + ' pedacinhos de ilha!'
            : j.nome + ' pintou +' + ganhas + '!', 'sucesso', j);
        }
      }
      j.explorador.travarMeiaVolta = false;
      j.ultimoSeguro = { x: x, y: y };
      return true;
    }

    // Fora de casa (grama ou território de outro): deixa tinta.
    if (grade.rastro(x, y) === 0) grade.setRastro(x, y, j.id);
    j.explorador.travarMeiaVolta = true;
    return true;
  }

  /* Penalidade suave: o rastro some e o explorador volta ao território. */
  function penalizar(j, mensagem) {
    var grade = jogo.grade;
    grade.limparRastro(j.id);
    var destino = j.ultimoSeguro;
    if (grade.dono(destino.x, destino.y) !== j.id) {
      // O lugar seguro foi tomado por outro jogador: procura a casa mais perto.
      var caminho = grade.buscarCaminho(destino.x, destino.y,
        function (x, y) { return grade.dono(x, y) === j.id; },
        function () { return false; });
      destino = caminho ? caminho[caminho.length - 1] : null;
    }
    if (!destino) {
      renascer(j);
    } else {
      j.explorador.teleportar(destino.x, destino.y);
      j.ultimoSeguro = { x: destino.x, y: destino.y };
    }
    if (j.ia) j.ia.reiniciar();
    avisar(mensagem, 'aviso', j);
  }

  /* Balão de mensagem; no multi o texto sai na cor do jogador envolvido. */
  function avisar(texto, tipo, j) {
    IT.ui.mostrarMensagem(texto, tipo, jogo.modo === 'multi' && j ? j.cor.escura : null);
  }

  /* Ninguém é eliminado: quem perdeu todo o território ganha uma ilhinha nova. */
  function renascer(j) {
    var grade = jogo.grade;
    grade.limparRastro(j.id);
    grade.pintarQuadrado(j.inicio.x, j.inicio.y, C.TERRITORIO_INICIAL, j.id);
    j.explorador.teleportar(j.inicio.x, j.inicio.y);
    j.ultimoSeguro = { x: j.inicio.x, y: j.inicio.y };
    if (j.ia) j.ia.reiniciar();
  }

  function darIlhaNovaParaQuemFicouSem() {
    jogo.jogadores.forEach(function (j) {
      if (jogo.grade.contar(j.id) === 0) {
        renascer(j);
        avisar(j.nome + ' ganhou uma ilhinha nova!', 'aviso', j);
      }
    });
  }

  /* Ranking: quem tem mais território primeiro. */
  function ranking() {
    return jogo.jogadores.map(function (j) {
      return { jogador: j, celulas: jogo.grade.contar(j.id), fracao: jogo.grade.fracao(j.id) };
    }).sort(function (a, b) { return b.celulas - a.celulas; });
  }

  /* Verifica se a partida acabou; se sim, mostra o fim e devolve true. */
  function verificarFim() {
    if (jogo.estado !== 'jogando') return true;
    var atingiuMeta = jogo.jogadores.some(function (j) {
      return jogo.grade.fracao(j.id) >= jogo.meta;
    });
    var acabouTempo = jogo.modo === 'multi' && jogo.tempoRestante <= 0;
    if (!atingiuMeta && !acabouTempo) return false;

    jogo.estado = 'fim';
    jogo.jogadores.forEach(function (j) {
      j.explorador.teleportar(j.explorador.x, j.explorador.y);
    });
    IT.ui.esconderMensagem();
    IT.ui.mostrarFim(jogo, ranking(), acabouTempo && !atingiuMeta);
    IT.renderer.soltarConfete();
    return true;
  }

  /* ---------- Fluxo de telas ---------- */

  /* Começa (ou recomeça) uma partida com a configuração dada. */
  function jogar(configuracao) {
    novaPartida(configuracao || jogo.configuracao);
    jogo.estado = 'jogando';
    IT.ui.esconderMensagem();
    IT.ui.prepararPartida(jogo);
    IT.ui.atualizarHUD(jogo);
    IT.ui.mostrarEstado('jogando');
  }

  function mudarJogadores() {
    jogo.estado = 'configuracao';
    IT.ui.mostrarEstado('configuracao');
  }

  /*
   * Decide qual jogador humano recebe uma direção do teclado ou do toque.
   * Com um único humano, ele aceita WASD, setas, os botões de toque e o próprio
   * esquema. Com vários humanos, cada um usa o esquema da sua vaga e os botões
   * de toque controlam o primeiro humano.
   */
  function direcionar(esquema, direcao) {
    if (jogo.estado !== 'jogando') return false;
    var humanos = jogo.jogadores.filter(function (j) { return j.tipo === 'humano'; });
    var alvo = null;
    if (humanos.length === 1) {
      if (esquema === 0 || esquema === 1 || esquema === 'toque' || esquema === humanos[0].slot) alvo = humanos[0];
    } else if (esquema === 'toque') {
      alvo = humanos[0] || null;
    } else {
      alvo = humanos.filter(function (j) { return j.slot === esquema; })[0] || null;
    }
    if (!alvo) return false;
    alvo.explorador.pedirDirecao(direcao);
    return true;
  }

  /* Enter/Espaço: confirma a tela atual. */
  function confirmar() {
    if (jogo.estado === 'jogando') return false;
    if (jogo.estado === 'configuracao') {
      jogar(IT.setup ? IT.setup.configuracao() : CONFIGURACAO_SOLO);
    } else {
      jogar();
    }
    return true;
  }

  /* ---------- Loop ---------- */

  var segundoAnterior = -1;

  /* Avança a lógica do jogo em "dt" segundos (sem desenhar). */
  function passo(dt) {
    jogo.ultimoTempo += dt;
    if (jogo.estado !== 'jogando') return;
    for (var i = 0; i < jogo.jogadores.length && jogo.estado === 'jogando'; i++) {
      var j = jogo.jogadores[i];
      j.explorador.atualizar(dt, jogo.grade, j.aoChegar);
    }
    if (jogo.modo === 'multi' && jogo.estado === 'jogando') {
      jogo.tempoRestante = Math.max(0, jogo.tempoRestante - dt);
      var segundo = Math.ceil(jogo.tempoRestante);
      if (segundo !== segundoAnterior) {
        segundoAnterior = segundo;
        IT.ui.atualizarRelogio(jogo.tempoRestante);
      }
      verificarFim();
    }
  }

  var relogioAnterior = 0;

  function quadro(agoraMs) {
    var agora = agoraMs / 1000;
    var dt = Math.min(0.05, agora - (relogioAnterior || agora)); // limita saltos
    relogioAnterior = agora;
    passo(dt);
    IT.renderer.desenhar(jogo.grade, jogo.jogadores, agora, jogo.modo);
    requestAnimationFrame(quadro);
  }

  window.addEventListener('load', function () {
    IT.renderer.iniciar(document.getElementById('tela'));
    novaPartida(CONFIGURACAO_SOLO); // mapa de fundo atrás da tela de configuração
    IT.ui.iniciar({
      aoJogar: function () { jogar(IT.setup ? IT.setup.configuracao() : CONFIGURACAO_SOLO); },
      aoJogarDeNovo: function () { jogar(); },
      aoMudarJogadores: mudarJogadores
    });
    if (IT.setup) IT.setup.iniciar();
    IT.ui.prepararPartida(jogo);
    IT.ui.atualizarHUD(jogo);
    IT.ui.mostrarEstado('configuracao');
    IT.input.iniciar(direcionar, confirmar);
    requestAnimationFrame(quadro);
  });

  // Exposto para depuração e testes no console.
  jogo.jogar = jogar;
  jogo.passo = passo; // usado por tests/simulacao.html para acelerar partidas
  jogo.ranking = ranking;
  IT.jogo = jogo;
})(window.IlhasDeTinta);

/*
 * depuracao.js — registro das decisões de um "cérebro" (robô campeão ou CPU).
 *
 * Liga-se a um cérebro de js/ai.js (cerebro.depuracao = registro). A cada
 * célula o cérebro chama registro.decisao(); quando compara voltas, chama
 * registro.candidatos(). O registro só LÊ o estado do jogo (nada de sorteio,
 * nada de mudar o mapa): a partida é exatamente a mesma com ou sem ele
 * (conferido em tests/genetico/teste_depuracao.js).
 *
 * Guarda uma ENTRADA a cada mudança de decisão (não a cada passo) e a cada
 * evento (pintou território, cortou alguém, teve o rastro cortado), com:
 *   tempo da partida, frase em português simples, os números usados, o
 *   ranking das voltas candidatas (quando escolheu uma volta) e uma "foto"
 *   leve do mapa com os desenhos daquela hora.
 * Formato do JSON: tests/genetico/RELATORIO.md ("Modo depuração").
 *
 * Usado por: tests/genetico/depurar-tela.js (navegador, ?debug=1) e
 *            tests/genetico/registrar.js (Node, --log arquivo.json).
 */
(function (IT) {
  'use strict';

  var NOMES_DIRECAO = { cima: 'para cima', baixo: 'para baixo', esquerda: 'para a esquerda', direita: 'para a direita' };

  function apelido(j) {
    if (!j) return '?';
    return j.tipo === 'cpu' && j.dificuldade === 'desafio' ? '😈' : j.nome;
  }

  /* Número curto em português (vírgula decimal); ∞ quando não há caminho. */
  function num(v, casas) {
    if (v === null || v === undefined || v === Infinity || isNaN(v)) return '∞';
    var f = Math.pow(10, casas || 0);
    return String(Math.round(v * f) / f).replace('.', ',');
  }

  function finito(v) { return v === Infinity || v === undefined || (typeof v === 'number' && isNaN(v)) ? null : v; }

  /* Mapa em texto: um dígito (0–4) por célula. */
  function codificar(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  function criar(jogo, jogador, opcoes) {
    opcoes = opcoes || {};
    var id = jogador.id;
    var est = jogador.estatisticas || { cortes: 0, rastroCortado: 0, proprioRastro: 0 };
    var r = {
      sujeito: { id: id, nome: jogador.nome, tipo: jogador.tipo, dificuldade: jogador.dificuldade },
      jogo: jogo,
      jogador: jogador,
      grade: jogo.grade,
      inicio: jogo.ultimoTempo,
      entradas: [],
      decisoes: 0,          // quantas vezes o cérebro decidiu (uma por célula)
      atual: null,          // decisão de agora: { frase, modo, desenhos, t }
      parametros: null,
      fotos: opcoes.fotos !== false,
      chave: null,
      pendentes: null,      // ranking das voltas comparadas, até virar entrada
      voltas: 0,
      territorio: jogo.grade.contar(id),
      cortes: est.cortes,
      cortado: est.rastroCortado,
      proprio: est.proprioRastro,
      ultimoAlvo: null
    };

    function tempo() { return Math.round((jogo.ultimoTempo - r.inicio) * 100) / 100; }
    function porId(i) { return jogo.jogadores[i - 1]; }

    function placar() {
      var g = r.grade;
      return jogo.jogadores.map(function (j) {
        return { nome: j.nome, pct: Math.round(1000 * g.contar(j.id) / g.total) / 10 };
      }).sort(function (a, b) { return b.pct - a.pct; });
    }

    function foto(desenhos) {
      if (!r.fotos) return null;
      return {
        donos: codificar(r.grade.donos),
        rastros: codificar(r.grade.rastros),
        jogadores: jogo.jogadores.map(function (j) { return { id: j.id, x: j.explorador.x, y: j.explorador.y }; }),
        desenhos: desenhos
      };
    }

    /* Volta candidata em forma legível (para o ranking). */
    function descreverVolta(c, escolhida) {
      var p = c.plano, d = c.detalhe || {};
      var x0 = Math.min(p.canto.x, p.oposto.x), x1 = Math.max(p.canto.x, p.oposto.x);
      var y0 = Math.min(p.canto.y, p.oposto.y), y1 = Math.max(p.canto.y, p.oposto.y);
      var roubo = Object.keys(d.roubo || {}).map(function (k) {
        return { de: porId(+k) ? apelido(porId(+k)) : k, casas: d.roubo[k] };
      });
      var v = {
        nota: Math.round(c.nota * 100) / 100,
        direcao: p.direcao, lado: p.lado,
        largura: x1 - x0 + 1, altura: y1 - y0 + 1,
        retangulo: { x0: x0, y0: y0, x1: x1, y1: y1 },
        area: d.area, grama: d.grama, roubo: roubo,
        antesDoRisco: d.antesDoRisco !== undefined ? Math.round(d.antesDoRisco * 100) / 100 : null,
        risco: !!d.risco, adversarioMaisPerto: finito(d.adversarioMaisPerto),
        raioDeRisco: d.raioDeRisco !== undefined ? Math.round(d.raioDeRisco * 100) / 100 : null,
        fatorRisco: d.fatorRisco !== undefined ? Math.round(d.fatorRisco * 1000) / 1000 : null,
        escolhida: !!escolhida
      };
      if (d.borda !== undefined) v.borda = Math.round(d.borda * 100) / 100;
      return v;
    }

    /* Chamado pelo cérebro ao comparar voltas (criarPlano). */
    r.candidatos = function (cerebro, lista, melhor) {
      var ranking = lista.map(function (c) { return descreverVolta(c, c.plano === melhor); })
        .sort(function (a, b) { return b.nota - a.nota; });
      ranking.forEach(function (v, i) { v.posicao = i + 1; });
      r.voltas++;
      r.pendentes = ranking;
      if (cerebro.motivo && cerebro.motivo.tipo === 'volta') {
        var esc = ranking.filter(function (v) { return v.escolhida; })[0];
        cerebro.motivo.nota = esc ? esc.nota : null;
      }
    };

    /* Quanto cada adversário precisa andar para alcançar o MEU rastro (sem pisar no dele). */
    function alcances(rastro) {
      if (!rastro) return [];
      var g = r.grade;
      return jogo.jogadores.filter(function (j) { return j !== jogador; }).map(function (j) {
        var c = g.buscarCaminho(j.explorador.x, j.explorador.y,
          function (x, y) { return g.rastro(x, y) === id; },
          function (x, y) { return g.rastro(x, y) === j.id; });
        var v = j.explorador.velocidade || 1;
        return { id: j.id, nome: j.nome, apelido: apelido(j), passos: c ? c.length : null, tempo: c ? c.length / v : Infinity };
      });
    }

    /* Desenhos do momento: volta planejada, caminho para casa, mira, vigia e área de perigo. */
    function desenhar(cerebro, rastro, emCasa, limite) {
      var g = r.grade, e = jogador.explorador, d = { plano: null, caminhoCasa: null, mira: null, vigia: null, perigo: null };
      var pe = cerebro.planoEscolhido;
      if (cerebro.modo === 'sair' && pe) {
        d.plano = {
          x0: Math.min(pe.canto.x, pe.oposto.x), y0: Math.min(pe.canto.y, pe.oposto.y),
          x1: Math.max(pe.canto.x, pe.oposto.x), y1: Math.max(pe.canto.y, pe.oposto.y),
          pontos: pe.pontos.map(function (p) { return [p.x, p.y]; })
        };
      }
      if (rastro > 0 || !emCasa) {
        var volta = cerebro.caminhoDeVolta(jogador);
        if (volta) d.caminhoCasa = [[e.x, e.y]].concat(volta.map(function (c) { return [c.x, c.y]; }));
      }
      if (cerebro.modo === 'cacar' && cerebro.plano[0]) d.mira = [cerebro.plano[0].x, cerebro.plano[0].y];
      if (cerebro.modo === 'vigiar' && cerebro.plano[0]) d.vigia = [cerebro.plano[0].x, cerebro.plano[0].y];
      if (rastro > 0) {
        var marcadas = new Uint8Array(g.total), lista = [];
        jogo.jogadores.forEach(function (j) {
          if (j === jogador) return;
          var v = j.explorador.velocidade || 1;
          var dist = cerebro.mapaDeDistancias(j.explorador.x, j.explorador.y, function (x, y) { return g.rastro(x, y) === j.id; });
          for (var k = 0; k < g.total; k++) {
            if (dist[k] >= 0 && dist[k] / v <= limite && !marcadas[k]) { marcadas[k] = 1; lista.push(k); }
          }
        });
        d.perigo = lista;
      }
      return d;
    }

    /* A frase da decisão (curta, português simples). */
    function frase(cerebro, m, n) {
      var a;
      switch (m.tipo) {
        case 'volta': {
          var esc = (r.pendentes || []).filter(function (v) { return v.escolhida; })[0];
          if (!esc) return 'Saindo para desenhar uma volta';
          var roubo = esc.roubo.map(function (x) { return x.casas + ' de ' + x.de; }).join(' + ');
          return 'Escolhi uma volta ' + esc.largura + '×' + esc.altura + ' ' + (NOMES_DIRECAO[esc.direcao] || '') + ': ' +
            esc.grama + ' de grama' + (roubo ? ' + ' + roubo : '') + (esc.risco ? ', com adversário perto' : '') +
            ' (nota ' + num(esc.nota, 1) + ', a melhor de ' + r.pendentes.length + ')';
        }
        case 'semVolta': return 'Nenhuma volta possível daqui: fico em casa';
        case 'espera': return 'Em casa, respirando antes de sair de novo';
        case 'rastroMax': return 'Voltando: meu rastro já tem ' + m.rastro + ' casas (meu limite é ' + m.max + ')';
        case 'medo': return 'Voltando: tem adversário a ' + m.distancia + ' casas de mim (meu medo é ' + m.medo + ')';
        case 'fimDaVolta': return 'Volta desenhada: fechando, faltam ' + num(n.casa) + ' passos até casa';
        case 'perigo': {
          a = maisRapido(n.adversarios);
          if (!a) return 'Voltando: alguém alcançaria meu rastro antes de eu chegar em casa';
          return 'Voltando: ' + a.apelido + ' chega no meu rastro em ' + num(a.passos) + ', eu em casa em ' + num(n.casa) +
            (n.folga ? ' + margem ' + num(n.folga, 1) + ' = ' + num(n.casa + n.folga, 1) : '') + ' (' + num(a.passos) + ' ≤ ' + num(n.casa + n.folga, 1) + ')';
        }
        case 'corte': {
          var c = m.corte, alvo = porId(c.alvo);
          return 'Caçando ' + apelido(alvo) + ': chego ' + (c.onde === 'caminho' ? 'no caminho de volta dele' : 'no rastro dele') +
            ' em ' + c.passos + ', ele em casa em ' + num(c.tempoDele, 1);
        }
        case 'vigia': return 'De olho no caminho de volta de ' + apelido(porId(m.vigia.alvo)) + ' (estou a ' + m.vigia.passos + ' passos)';
        case 'respiro': return 'Cortei! Descanso ' + num(m.segundos, 1) + ' s antes de caçar de novo';
        case 'fimCaca': return m.descansando ? 'Parei de caçar: descansando depois do corte' : 'Parei de caçar: não chego a tempo em ninguém';
        case 'caca': return 'Caçando o rastro de ' + apelido(porId(m.alvo)) + ' (a ' + num(n.alvoPassos) + ' passos)';
        case 'inalcancavel': return 'Não dá para seguir a volta: voltando para casa';
        case 'reinicio': return 'Recomeçando em casa';
        default: return 'Começando a partida';
      }
    }

    function maisRapido(lista) {
      var m = null;
      (lista || []).forEach(function (a) { if (a.passos !== null && (!m || a.tempo < m.tempo)) m = a; });
      return m;
    }

    /* Frase do balão (números de AGORA, não só do momento da decisão). */
    function fraseAoVivo(cerebro, m, n, fraseDaDecisao) {
      if (cerebro.modo === 'voltar' && n.rastro > 0 && (m.tipo === 'perigo' || m.tipo === 'medo' || m.tipo === 'rastroMax' || m.tipo === 'fimDaVolta')) {
        var a = maisRapido(n.adversarios);
        var prefixo = { perigo: 'Voltando', medo: 'Voltando (medo)', rastroMax: 'Voltando (rastro longo)', fimDaVolta: 'Fechando a volta' }[m.tipo];
        return prefixo + ': ' + (a ? a.apelido + ' chega no meu rastro em ' + num(a.passos) + ', ' : '') + 'eu em casa em ' + num(n.casa);
      }
      if (m.tipo === 'volta' && cerebro.modo === 'sair') {
        var pe = cerebro.planoEscolhido;
        if (pe) {
          var l = Math.abs(pe.oposto.x - pe.canto.x) + 1, h = Math.abs(pe.oposto.y - pe.canto.y) + 1;
          return 'Desenhando uma volta ' + l + '×' + h + (m.nota !== null && m.nota !== undefined ? ' (nota ' + num(m.nota, 0) + ')' : '') +
            (n.rastro ? ' — rastro ' + n.rastro + ', casa em ' + num(n.casa) : '');
        }
      }
      return fraseDaDecisao;
    }

    function limpar(m) { // motivo em JSON (sem Infinity, com nomes)
      return JSON.parse(JSON.stringify(m, function (k, v) {
        if (v === Infinity) return null;
        return v;
      }));
    }

    function registrarEvento(evento, texto, desenhos) {
      r.entradas.push({ n: r.entradas.length + 1, t: tempo(), tipo: 'evento', evento: evento, frase: texto, placar: placar(), foto: foto(desenhos) });
    }

    /* Chamado pelo cérebro a cada célula, depois de escolher a direção. */
    r.decisao = function (cerebro, direcao) {
      r.decisoes++;
      if (!r.parametros) r.parametros = limpar(cerebro.parametros || cerebro.nivel);
      var g = r.grade, e = jogador.explorador;
      var rastro = g.tamanhoRastro(id);
      var emCasa = g.dono(e.x, e.y) === id;
      var casa = cerebro.distanciaDeCasa(e.x, e.y);
      var vEu = e.velocidade || 1;
      var folga = cerebro.nivel.folgaPerigo || 0;
      var limite = (casa + folga) / vEu;
      var m = cerebro.motivo || { tipo: 'inicio' };
      var n = { rastro: rastro, casa: finito(casa), folga: folga, limite: finito(limite), adversarios: alcances(rastro) };
      if (m.tipo === 'caca' && m.ponto) n.alvoPassos = cerebro.distancia(e.x, e.y, function (x, y) { return x === m.ponto.x && y === m.ponto.y; });
      if (m.tipo === 'corte') r.ultimoAlvo = m.corte.alvo;
      var desenhos = desenhar(cerebro, rastro, emCasa, limite);

      // Eventos desde a última decisão.
      var est = jogador.estatisticas || {};
      var terr = g.contar(id);
      if (est.rastroCortado > r.cortado) registrarEvento('cortado', '💥 Cortaram meu rastro: recomeço em casa', desenhos);
      if (est.proprioRastro > r.proprio) registrarEvento('proprio', '😵 Pisei no meu próprio rastro', desenhos);
      if (est.cortes > r.cortes) registrarEvento('cortei', '✂️ Cortei o rastro de ' + (r.ultimoAlvo ? apelido(porId(r.ultimoAlvo)) : 'alguém'), desenhos);
      if (terr > r.territorio + 0 && rastro === 0 && !(est.rastroCortado > r.cortado)) {
        registrarEvento('pintou', '🎨 Fechei a volta: +' + (terr - r.territorio) + ' casas (agora ' + num(100 * terr / g.total, 1) + '%)', desenhos);
      }
      r.territorio = terr; r.cortado = est.rastroCortado; r.proprio = est.proprioRastro; r.cortes = est.cortes;

      var texto = frase(cerebro, m, n);
      var alvo = m.tipo === 'corte' ? m.corte.alvo : m.tipo === 'vigia' ? m.vigia.alvo : m.tipo === 'caca' ? m.alvo : '';
      var chave = cerebro.modo + '|' + m.tipo + '|' + alvo + (m.tipo === 'volta' ? '|' + r.voltas : '');
      if (chave !== r.chave) {
        r.chave = chave;
        var entrada = {
          n: r.entradas.length + 1, t: tempo(), tipo: 'decisao', modo: cerebro.modo, motivo: m.tipo,
          frase: texto, numeros: limpar(n), detalhe: limpar(m), direcao: direcao,
          posicao: [e.x, e.y], placar: placar(), foto: foto(desenhos)
        };
        if (m.tipo === 'volta' && r.pendentes) { entrada.candidatos = r.pendentes; r.pendentes = null; }
        r.entradas.push(entrada);
      }
      r.atual = { t: tempo(), modo: cerebro.modo, motivo: m.tipo, frase: fraseAoVivo(cerebro, m, n, texto), desenhos: desenhos, numeros: n };
    };

    /* O log inteiro em JSON (o mesmo no navegador e no Node). */
    r.exportar = function (extra) {
      var g = r.grade;
      var saida = {
        formato: 'ilhas-de-tinta/depuracao', versao: 1,
        sujeito: r.sujeito,
        parametros: r.parametros,
        mapa: { colunas: g.colunas, linhas: g.linhas },
        jogadores: jogo.jogadores.map(function (j) {
          return { id: j.id, nome: j.nome, tipo: j.tipo, dificuldade: j.dificuldade, cor: j.corNome, velocidade: j.explorador.velocidade };
        }),
        decisoes: r.decisoes,
        entradas: r.entradas
      };
      Object.keys(extra || {}).forEach(function (k) { saida[k] = extra[k]; });
      return saida;
    };

    return r;
  }

  /* Liga um registro novo ao cérebro de "jogador" (devolve o registro). */
  function ligar(jogo, jogador, opcoes) {
    if (!jogador.ia) return null;
    var r = criar(jogo, jogador, opcoes);
    jogador.ia.depuracao = r;
    return r;
  }

  IT.depuracao = { criar: criar, ligar: ligar, apelido: apelido };
})(window.IlhasDeTinta);

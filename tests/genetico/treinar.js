#!/usr/bin/env node
/*
 * treinar.js — treina um robô (algoritmo genético) para vencer a CPU Impossível 😈.
 *
 *   node tests/genetico/treinar.js --cenario 1x1          (ou 3j, 4j)
 *   opções: --populacao 50 --geracoes 40 --partidas 12 --elite 3 --semente 1
 *           --workers 15 --continuar (retoma do checkpoint)
 *
 * Cada geração: todos os robôs jogam as MESMAS K partidas (sementes novas a
 * cada geração, para não decorar mapas); aptidão = média de genetico.aptidaoDaPartida.
 * Grava a cada geração em resultados/<cenario>/: checkpoint.json (para retomar)
 * e historico.json. No fim, escolhe o campeão (os melhores reavaliados em mais
 * partidas novas) e grava campeao.json. A validação é em validar.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sim = require('./simulador');
const G = require('./genetico');
const { criarPiscina } = require('./piscina');

function lerOpcoes(argv) {
  const o = { cenario: '1x1', populacao: 50, geracoes: 40, partidas: 12, elite: 3, semente: 1, workers: 0, continuar: false, final: 40 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'continuar') { o.continuar = true; continue; }
    if (!(k in o)) throw new Error('opção desconhecida: ' + argv[i]);
    o[k] = k === 'cenario' ? argv[++i] : +argv[++i];
  }
  if (!sim.CENARIOS[o.cenario]) throw new Error('cenário: 1x1, 3j ou 4j');
  return o;
}

const OPERADORES = { torneio: 3, chanceCruzar: 0.9, alfa: 0.3, taxaMutacao: 0.2, sigmaInicial: 0.2, sigmaFinal: 0.04 };
const N_GENES = 14;
// Sementes: treino = 1.000.000 + geração*1000 + k; escolha do campeão = 5.000.000+; validação (validar.js) = 9.000.000+.
const sementeTreino = (geracao, k) => 1000000 + geracao * 1000 + k;

async function avaliar(piscina, cenario, populacao, sementes) {
  const tarefas = [];
  populacao.forEach((genes) => sementes.forEach((semente) => tarefas.push({ cenario, semente, genes })));
  const rs = await piscina.jogar(tarefas);
  return populacao.map((_, i) => {
    const meus = rs.slice(i * sementes.length, (i + 1) * sementes.length);
    const soma = (f) => meus.reduce((a, r) => a + f(r), 0);
    return {
      aptidao: soma(G.aptidaoDaPartida) / meus.length,
      vitorias: soma((r) => (r.venceu ? 1 : 0)) / meus.length,
      pct: soma((r) => r.pctRobo) / meus.length,
      cortado: soma((r) => r.rastroCortado) / meus.length
    };
  });
}

async function main() {
  const o = lerOpcoes(process.argv.slice(2));
  const pasta = path.join(__dirname, 'resultados', o.cenario);
  fs.mkdirSync(pasta, { recursive: true });
  const arqCheck = path.join(pasta, 'checkpoint.json');
  const s = G.criarSorteio(o.semente);
  let populacao, historico = [], inicio = 0, jaUsados = 0;
  if (o.continuar && fs.existsSync(arqCheck)) {
    const c = JSON.parse(fs.readFileSync(arqCheck, 'utf8'));
    populacao = c.populacao; historico = c.historico; inicio = c.geracao + 1;
    jaUsados = c.sorteiosUsados;
    for (let i = 0; i < jaUsados; i++) s.r(); // retoma a mesma sequência de sorteios
    Object.assign(o, c.opcoes, { continuar: true, geracoes: o.geracoes });
    console.log('retomando da geração', inicio);
  } else {
    populacao = Array.from({ length: o.populacao }, () => G.aleatorio(s, N_GENES));
  }
  let sorteios = 0; const r0 = s.r; s.r = () => { sorteios++; return r0(); };
  const piscina = criarPiscina(o.workers || undefined);
  console.log(`cenário ${o.cenario}: população ${o.populacao}, ${o.geracoes} gerações, ${o.partidas} partidas cada, ${piscina.quantos} workers`);
  const t0 = Date.now();
  let ultima = null;
  for (let g = inicio; g < o.geracoes; g++) {
    const sementes = Array.from({ length: o.partidas }, (_, k) => sementeTreino(g, k));
    const notas = await avaliar(piscina, o.cenario, populacao, sementes);
    const apt = notas.map((n) => n.aptidao);
    const ib = apt.indexOf(Math.max(...apt));
    const media = apt.reduce((a, b) => a + b, 0) / apt.length;
    const linha = {
      geracao: g, melhor: +apt[ib].toFixed(4), media: +media.toFixed(4),
      vitoriasDoMelhor: +notas[ib].vitorias.toFixed(3),
      vitoriasMedia: +(notas.reduce((a, n) => a + n.vitorias, 0) / notas.length).toFixed(3),
      pctDoMelhor: +notas[ib].pct.toFixed(3), genesDoMelhor: populacao[ib].map((v) => +v.toFixed(4))
    };
    historico.push(linha);
    console.log(`ger ${String(g).padStart(2)}  melhor ${linha.melhor.toFixed(3)} (vence ${(100 * linha.vitoriasDoMelhor).toFixed(0)}%)  média ${linha.media.toFixed(3)} (vence ${(100 * linha.vitoriasMedia).toFixed(0)}%)  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    ultima = { populacao, apt };
    const progresso = o.geracoes > 1 ? g / (o.geracoes - 1) : 1;
    const nova = g < o.geracoes - 1 ? G.proximaGeracao(s, populacao, apt, Object.assign({ elite: o.elite, progresso }, OPERADORES)) : populacao;
    fs.writeFileSync(arqCheck, JSON.stringify({ opcoes: o, geracao: g, populacao: nova, historico, sorteiosUsados: jaUsados + sorteios }));
    fs.writeFileSync(path.join(pasta, 'historico.json'), JSON.stringify({ cenario: o.cenario, opcoes: o, operadores: OPERADORES, geracoes: historico }, null, 1));
    populacao = nova;
  }

  // Campeão: os 8 melhores da última geração + o melhor de cada uma das 10 últimas
  // gerações, reavaliados em mais partidas novas (5.000.000+). Fica o de maior aptidão.
  const finalistas = [];
  const ordem = ultima.apt.map((_, i) => i).sort((a, b) => ultima.apt[b] - ultima.apt[a]).slice(0, 8);
  ordem.forEach((i) => finalistas.push(ultima.populacao[i]));
  historico.slice(-10).forEach((h) => finalistas.push(h.genesDoMelhor));
  const sementesFinal = Array.from({ length: o.final }, (_, k) => 5000000 + k);
  const notasFinal = await avaliar(piscina, o.cenario, finalistas, sementesFinal);
  const iv = notasFinal.map((n) => n.aptidao);
  const ic = iv.indexOf(Math.max(...iv));
  const genes = finalistas[ic].map((v) => +v.toFixed(4));
  const robo = sim.criarMundo().IT.robo;
  const campeao = {
    cenario: o.cenario, genes, parametros: robo.decodificar(genes),
    escolha: { partidas: o.final, aptidao: +iv[ic].toFixed(4), vitorias: +notasFinal[ic].vitorias.toFixed(3), pctMedio: +notasFinal[ic].pct.toFixed(3) },
    treino: { populacao: o.populacao, geracoes: o.geracoes, partidasPorGeracao: o.partidas, semente: o.semente, segundos: Math.round((Date.now() - t0) / 1000) }
  };
  fs.writeFileSync(path.join(pasta, 'campeao.json'), JSON.stringify(campeao, null, 1));
  console.log('campeão:', JSON.stringify(campeao.escolha), JSON.stringify(campeao.parametros));
  await piscina.fechar();
}
main().catch((e) => { console.error(e); process.exit(1); });

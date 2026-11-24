/*
 * simulador.js — roda a lógica REAL do jogo (config, grid, player, ai, game) no
 * Node, sem tela, para treinar e testar robôs (issue do algoritmo genético).
 *
 * - Os arquivos do jogo são carregados num contexto `vm` com um `window` mínimo;
 *   tela (IT.ui), desenho (IT.renderer) e som (IT.som) viram "nada" (Proxy que
 *   aceita qualquer chamada). As regras são as do game.js de verdade.
 * - Passo de tempo fixo (1/60 s, como tests/simulacao.html) e Math.random do
 *   contexto trocado por um gerador com semente (mulberry32): mesma semente +
 *   mesmo robô = mesmo resultado.
 * - O robô (robo.js) controla o J1 só escolhendo direções, como o teclado.
 *
 * Uso:  const sim = require('./simulador'); const m = sim.criarMundo();
 *       m.jogarPartida({ cenario: '1x1', semente: 7, genes: [...] })
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const ARQUIVOS_DO_JOGO = ['js/config.js', 'js/grid.js', 'js/player.js', 'js/ai.js', 'js/game.js'];
const DT = 1 / 60;

/* Gerador com semente (mulberry32): o mesmo usado em conferir.html no navegador. */
function mulberry32(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Composição de cada cenário (o robô é sempre o J1, humano, velocidade 1). */
const CENARIOS = {
  '1x1': [{ tipo: 'cpu', cor: 'azul', nome: 'CPU Impossível', dificuldade: 'desafio' }],
  '3j': [
    { tipo: 'cpu', cor: 'azul', nome: 'CPU Impossível', dificuldade: 'desafio' },
    { tipo: 'cpu', cor: 'amarelo', nome: 'CPU Difícil', dificuldade: 'dificil' }
  ],
  '4j': [
    { tipo: 'cpu', cor: 'azul', nome: 'CPU Impossível', dificuldade: 'desafio' },
    { tipo: 'cpu', cor: 'amarelo', nome: 'CPU Difícil', dificuldade: 'dificil' },
    { tipo: 'cpu', cor: 'roxo', nome: 'CPU Médio', dificuldade: 'medio' }
  ]
};

/* "Nada": aceita qualquer propriedade e qualquer chamada (tela, desenho, som). */
function nada() {
  const alvo = function () {};
  const p = new Proxy(alvo, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : p),
    apply: () => undefined
  });
  return p;
}

function criarMundo(opcoes) {
  opcoes = opcoes || {};
  const elemento = { addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, hidden: true, textContent: '', querySelector() { return elemento; }, querySelectorAll() { return []; } };
  const ctx = {
    console,
    URLSearchParams,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; },
    performance: { now: () => 0 },
    navigator: { maxTouchPoints: 0 },
    location: { search: '', protocol: 'file:' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    document: {
      addEventListener() {}, getElementById: () => elemento, querySelectorAll: () => [],
      body: elemento.classList ? { classList: elemento.classList } : elemento, visibilityState: 'visible', activeElement: null
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const arq of ARQUIVOS_DO_JOGO) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, arq), 'utf8'), ctx, { filename: arq });
  }
  // Tela, desenho e som: "nada". (O load do game.js nunca dispara aqui.)
  ctx.IlhasDeTinta.ui = nada();
  ctx.IlhasDeTinta.renderer = nada();
  ctx.IlhasDeTinta.som = nada();
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'robo.js'), 'utf8'), ctx, { filename: 'robo.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'depuracao.js'), 'utf8'), ctx, { filename: 'depuracao.js' });
  const IT = ctx.IlhasDeTinta;
  const mathDoJogo = vm.runInContext('Math', ctx);

  /*
   * Joga uma partida inteira e devolve o resultado.
   * cfg: { cenario, semente, genes (robô genético) | perfil ('esperto') | humanoParado: true,
   *        depurar: true (grava o registro de decisões em resultado.registro),
   *        sujeito: número do jogador a registrar (padrão: 1, o robô) }
   */
  function jogarPartida(cfg) {
    const vagas = [{ tipo: 'humano', cor: 'rosa', nome: 'Robô', dificuldade: 'medio' }]
      .concat(JSON.parse(JSON.stringify(CENARIOS[cfg.cenario])));
    const jogo = IT.jogo;
    jogo.ultimoTempo = 0; // o jogo acumula entre partidas; zera para cada partida ser independente
    jogo.jogar({ vagas: vagas });
    // semente depois de montar a partida (no navegador o desenho também sorteia ao montar)
    mathDoJogo.random = mulberry32(cfg.semente);
    const robo = jogo.jogadores[0];
    if (cfg.genes) IT.robo.ligar(robo, jogo, cfg.genes);
    else if (cfg.perfil) IT.robo.ligarPerfil(robo, jogo, cfg.perfil);
    const registro = cfg.depurar ? IT.depuracao.ligar(jogo, jogo.jogadores[(cfg.sujeito || 1) - 1]) : null;
    const maxPassos = Math.ceil((IT.config.TEMPO_LIMITE + 2) / DT);
    let passos = 0;
    while (jogo.estado === 'jogando' && passos < maxPassos) { jogo.passo(DT); passos++; }
    const ranking = jogo.ranking();
    const total = jogo.grade.total;
    const meu = ranking.filter((r) => r.jogador === robo)[0];
    const melhorOutro = ranking.filter((r) => r.jogador !== robo)[0];
    const resultado = {
      venceu: ranking[0].jogador === robo && ranking[0].celulas > (ranking[1] ? ranking[1].celulas : -1),
      empate: ranking.length > 1 && ranking[0].celulas === ranking[1].celulas && (ranking[0].jogador === robo || ranking[1].jogador === robo),
      pctRobo: meu.celulas / total,
      pctMelhorOutro: melhorOutro.celulas / total,
      pcts: ranking.map((r) => [r.jogador.nome, Math.round(1000 * r.celulas / total) / 10]),
      rastroCortado: robo.estatisticas.rastroCortado,
      proprioRastro: robo.estatisticas.proprioRastro,
      cortesDoRobo: robo.estatisticas.cortes,
      segundos: Math.round(passos * DT),
      passos: passos,
      celulas: ranking.map((r) => r.jogador.nome + ' ' + r.celulas),
      // "impressão digital" do mapa final (para conferir que é determinístico e igual ao navegador)
      hash: hashMapa(jogo.grade)
    };
    if (registro) resultado.registro = registro.exportar({ cenario: cfg.cenario, semente: cfg.semente });
    jogo.estado = 'menu';
    return resultado;
  }

  return { jogarPartida, IT, ctx };
}

function hashMapa(grade) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < grade.total; i++) {
    h ^= grade.donos[i] * 7 + grade.rastros[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

module.exports = { criarMundo, mulberry32, CENARIOS, DT };

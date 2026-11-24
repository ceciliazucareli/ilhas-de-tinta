/*
 * genetico.js — operadores do algoritmo genético (sem nada do jogo aqui).
 * Indivíduo = vetor de genes entre 0 e 1 (o significado de cada um está em robo.js).
 *   seleção por torneio · cruzamento BLX-α · mutação gaussiana · elitismo
 * Tudo com sorteio próprio (semente), para o treino poder ser repetido.
 */
'use strict';
const { mulberry32 } = require('./simulador');

function criarSorteio(semente) {
  const r = mulberry32(semente);
  const s = {
    r,
    uniforme: (a, b) => a + (b - a) * r(),
    inteiro: (n) => Math.floor(r() * n),
    gauss() { // Box-Muller
      let u = 0; while (u === 0) u = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    },
    estado: () => undefined
  };
  return s;
}

const limitar = (v) => Math.max(0, Math.min(1, v));

function aleatorio(s, n) { return Array.from({ length: n }, () => s.r()); }

/* Torneio: sorteia k indivíduos e fica com o de maior aptidão. */
function torneio(s, populacao, aptidoes, k) {
  let melhor = -1;
  for (let i = 0; i < k; i++) {
    const c = s.inteiro(populacao.length);
    if (melhor < 0 || aptidoes[c] > aptidoes[melhor]) melhor = c;
  }
  return populacao[melhor];
}

/* BLX-α: cada gene do filho sai do intervalo dos pais, alargado em α dos dois lados. */
function cruzar(s, a, b, alfa) {
  return a.map((ga, i) => {
    const lo = Math.min(ga, b[i]), hi = Math.max(ga, b[i]), d = hi - lo;
    return limitar(s.uniforme(lo - alfa * d, hi + alfa * d));
  });
}

/* Mutação gaussiana: cada gene, com chance "taxa", leva um empurrão de desvio "sigma". */
function mutar(s, g, taxa, sigma) {
  return g.map((v) => (s.r() < taxa ? limitar(v + sigma * s.gauss()) : v));
}

/*
 * Próxima geração: os "elite" melhores passam intactos; o resto nasce de
 * torneio + cruzamento + mutação. "progresso" (0→1) faz a mutação diminuir.
 */
function proximaGeracao(s, populacao, aptidoes, op) {
  const ordem = populacao.map((_, i) => i).sort((x, y) => aptidoes[y] - aptidoes[x]);
  const nova = ordem.slice(0, op.elite).map((i) => populacao[i].slice());
  const sigma = op.sigmaInicial + (op.sigmaFinal - op.sigmaInicial) * op.progresso;
  while (nova.length < populacao.length) {
    const pai = torneio(s, populacao, aptidoes, op.torneio);
    const mae = torneio(s, populacao, aptidoes, op.torneio);
    let filho = s.r() < op.chanceCruzar ? cruzar(s, pai, mae, op.alfa) : pai.slice();
    filho = mutar(s, filho, op.taxaMutacao, sigma);
    nova.push(filho);
  }
  return nova;
}

/*
 * Aptidão de UMA partida: ganhar vale muito (1, empate 0,5); depois a diferença
 * de território para o melhor adversário; e perde um pouco por rastro cortado.
 */
function aptidaoDaPartida(r) {
  return (r.venceu ? 1 : r.empate ? 0.5 : 0) + (r.pctRobo - r.pctMelhorOutro) - 0.02 * r.rastroCortado;
}

/* Intervalo de confiança de Wilson (95%) para uma proporção. */
function wilson(vitorias, n, z) {
  z = z || 1.96;
  if (!n) return [0, 0];
  const p = vitorias / n, z2 = z * z;
  const centro = (p + z2 / (2 * n)) / (1 + z2 / n);
  const meia = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centro - meia), Math.min(1, centro + meia)];
}

module.exports = { criarSorteio, aleatorio, torneio, cruzar, mutar, proximaGeracao, aptidaoDaPartida, wilson };

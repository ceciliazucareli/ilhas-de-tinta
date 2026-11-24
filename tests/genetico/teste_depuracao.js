#!/usr/bin/env node
/*
 * teste_depuracao.js — o modo depuração NÃO pode mudar o jogo.
 * Joga as mesmas partidas com e sem o registro de decisões ligado (robô
 * campeão, robô esperto e a CPU Impossível como "sujeito") e confere que o
 * mapa final (hash) é idêntico. Também confere que o log explica uma fuga por
 * perigo, uma caçada e a escolha de uma volta.
 *   node tests/genetico/teste_depuracao.js
 */
'use strict';
const sim = require('./simulador');
const campeoes = {};
for (const c of ['1x1', '3j', '4j']) campeoes[c] = require('./resultados/' + c + '/campeao.json').genes;

const m = sim.criarMundo();
let falhas = 0, total = 0;
const motivos = {};
const casos = [];
for (const cenario of ['1x1', '3j', '4j']) {
  for (let k = 0; k < 4; k++) {
    casos.push({ cenario, semente: 7000000 + k, genes: campeoes[cenario] });
    casos.push({ cenario, semente: 7100000 + k, perfil: 'esperto' });
    casos.push({ cenario, semente: 7200000 + k, genes: campeoes[cenario], sujeito: 2 }); // registra o Impossível
  }
}
for (const c of casos) {
  const sem = m.jogarPartida(Object.assign({}, c));
  const com = m.jogarPartida(Object.assign({ depurar: true }, c));
  total++;
  const ok = sem.hash === com.hash && sem.passos === com.passos;
  if (!ok) { falhas++; console.log('DIFERENTE', JSON.stringify(c), sem.hash, com.hash); }
  com.registro.entradas.forEach((e) => { const k = e.tipo === 'evento' ? 'evento:' + e.evento : e.motivo; motivos[k] = (motivos[k] || 0) + 1; });
}
console.log(`${total - falhas}/${total} partidas idênticas com e sem depuração`);
console.log('motivos registrados:', JSON.stringify(motivos));
const precisa = ['perigo', 'corte', 'volta'];
const faltam = precisa.filter((k) => !motivos[k]);
if (faltam.length) { console.log('FALTOU no log:', faltam.join(', ')); falhas++; }
process.exit(falhas ? 1 : 0);

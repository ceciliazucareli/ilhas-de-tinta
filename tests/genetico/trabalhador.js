/* trabalhador.js — um worker_thread: carrega o jogo uma vez e joga as partidas que receber. */
'use strict';
const { parentPort } = require('worker_threads');
const sim = require('./simulador');
const mundo = sim.criarMundo();
parentPort.on('message', (tarefas) => {
  // tarefas: [{ id, cenario, semente, genes | perfil }]
  const resultados = tarefas.map((t) => {
    const r = mundo.jogarPartida(t);
    delete r.celulas; delete r.pcts;
    return Object.assign({ id: t.id }, r);
  });
  parentPort.postMessage(resultados);
});

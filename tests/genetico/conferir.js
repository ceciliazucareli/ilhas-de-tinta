/* Mesmas partidas de conferir.html, no simulador do Node: as linhas devem ser iguais. */
'use strict';
const sim = require('./simulador');
const { CASOS_CONFERIR, CENARIOS_CONFERIR } = require('./casos');
if (JSON.stringify(CENARIOS_CONFERIR) !== JSON.stringify(sim.CENARIOS)) throw new Error('casos.js e simulador.js com cenários diferentes');
const m = sim.criarMundo();
for (const c of CASOS_CONFERIR) {
  const r = m.jogarPartida(c);
  console.log(c.cenario + ' semente ' + c.semente + ' ' + (c.perfil || 'genes') + ': ' + r.hash + '  ' + r.passos + ' passos  ' + r.celulas.join(', '));
}

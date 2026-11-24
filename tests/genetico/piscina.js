/* piscina.js — um grupo de worker_threads que joga muitas partidas em paralelo. */
'use strict';
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

function criarPiscina(quantos) {
  quantos = quantos || Math.max(1, os.cpus().length - 1);
  let falhar = (e) => { throw e; };
  const workers = Array.from({ length: quantos }, () => {
    const w = new Worker(path.join(__dirname, 'trabalhador.js'));
    w.on('error', (e) => falhar(e));
    return w;
  });
  /* Joga todas as partidas (lista de tarefas) e devolve os resultados na mesma ordem. */
  function jogar(tarefas) {
    return new Promise((resolve, reject) => {
      const resultados = new Array(tarefas.length);
      const lote = Math.max(1, Math.ceil(tarefas.length / (quantos * 4)));
      let proximo = 0, faltam = tarefas.length;
      if (!faltam) return resolve(resultados);
      function enviar(w) {
        if (proximo >= tarefas.length) return;
        const pedaco = tarefas.slice(proximo, proximo + lote).map((t, i) => Object.assign({ id: proximo + i }, t));
        proximo += pedaco.length;
        w.once('message', (rs) => {
          rs.forEach((r) => { resultados[r.id] = r; });
          faltam -= rs.length;
          if (faltam === 0) resolve(resultados); else enviar(w);
        });
        w.postMessage(pedaco);
      }
      falhar = reject;
      workers.forEach(enviar);
    });
  }
  return { jogar, quantos, fechar: () => Promise.all(workers.map((w) => w.terminate())) };
}

module.exports = { criarPiscina };

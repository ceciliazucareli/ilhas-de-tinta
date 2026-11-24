#!/usr/bin/env node
/*
 * registrar.js — grava o log de decisões de UMA partida, sem navegador.
 *   node tests/genetico/registrar.js --log partida.json [--cenario 1x1|3j|4j]
 *        [--semente 9000000] [--robo campeao|esperto|cuidadoso] [--sujeito 1]
 *        [--sem-fotos] [--texto]
 * --sujeito escolhe de quem é o log (1 = o robô; 2 = o Impossível, ...).
 * --texto também imprime as linhas do log (tempo, frase) no terminal.
 * O JSON é o mesmo do botão "Baixar log (JSON)" do modo ?debug=1.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sim = require('./simulador');

const args = process.argv.slice(2);
const opcao = (n, p) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : p; };
const tem = (n) => args.includes('--' + n);
const cenario = opcao('cenario', '1x1');
const semente = +opcao('semente', 9000000);
const robo = opcao('robo', 'campeao');
const arquivo = opcao('log', null);
if (!arquivo && !tem('texto')) { console.error('uso: node tests/genetico/registrar.js --log partida.json [--cenario 1x1] [--semente N] [--robo campeao] [--sujeito 1] [--texto]'); process.exit(2); }

const cfg = { cenario, semente, depurar: true, sujeito: +opcao('sujeito', 1) };
if (robo === 'campeao') cfg.genes = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados', cenario, 'campeao.json'), 'utf8')).genes;
else cfg.perfil = robo;
const m = sim.criarMundo();
const r = m.jogarPartida(cfg);
const log = r.registro;
log.robo = robo;
log.resultado = { venceu: r.venceu, pcts: r.pcts, segundos: r.segundos };
if (tem('sem-fotos')) log.entradas.forEach((e) => { delete e.foto; });
if (arquivo) {
  fs.writeFileSync(arquivo, JSON.stringify(log));
  console.log(`gravado ${arquivo}: ${log.entradas.length} entradas, ${log.decisoes} decisões, ${(fs.statSync(arquivo).size / 1024).toFixed(0)} KB — ${r.venceu ? 'robô venceu' : 'robô perdeu'} (${r.pcts.map((p) => p.join(' ') + '%').join(', ')})`);
}
if (tem('texto')) {
  const mmss = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') + ',' + String(Math.floor((t % 1) * 10));
  log.entradas.forEach((e) => console.log(mmss(e.t) + '  ' + e.frase));
}

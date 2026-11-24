#!/usr/bin/env node
/* campeoes.js — junta os campeao.json de cada cenário em resultados/campeoes.js (usado por ?robo=campeao). */
'use strict';
const fs = require('fs');
const path = require('path');
const pasta = path.join(__dirname, 'resultados');
const todos = {};
for (const c of ['1x1', '3j', '4j']) {
  const arq = path.join(pasta, c, 'campeao.json');
  if (fs.existsSync(arq)) { const j = JSON.parse(fs.readFileSync(arq, 'utf8')); todos[c] = { genes: j.genes, parametros: j.parametros }; }
}
fs.writeFileSync(path.join(pasta, 'campeoes.js'),
  '/* Gerado por tests/genetico/campeoes.js — genes dos campeões do algoritmo genético, por cenário. */\n' +
  'window.IlhasDeTinta.campeoes = ' + JSON.stringify(todos, null, 1) + ';\n');
console.log('campeões:', Object.keys(todos).join(', ') || 'nenhum');

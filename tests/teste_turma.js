#!/usr/bin/env node
/*
 * teste_turma.js — turma fixa e QR code, sem navegador.
 *   node tests/teste_turma.js
 * Carrega js/turma.js (com um "window" mínimo) e confere:
 *   - ids de turma: apelido sem acento + 5 caracteres sem ambiguidade, válidos e diferentes;
 *   - lista de turmas, nome e cor lembrados (localStorage de mentira; sem ele, não quebra);
 *   - o QR desenhado por IT.turma.desenharQR, lido pelo jsQR (tests/vendor), volta EXATAMENTE o link.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const jsQR = require('./vendor/jsQR-1.4.0.js');

let falhas = 0;
function ok(cond, texto) { console.log((cond ? 'ok    ' : 'FALHA ') + texto); if (!cond) falhas++; }

function mundo(comArmazenamento) {
  const guardado = {};
  const pixels = { w: 0, h: 0, dados: null, cor: '#000' };
  const ctx2d = {
    set fillStyle(c) { pixels.cor = c; }, get fillStyle() { return pixels.cor; },
    fillRect(x, y, w, h) {
      const v = pixels.cor === '#ffffff' ? 255 : 0;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        const k = (j * pixels.w + i) * 4; pixels.dados[k] = pixels.dados[k + 1] = pixels.dados[k + 2] = v; pixels.dados[k + 3] = 255;
      }
    }
  };
  const canvas = {
    style: {},
    set width(w) { pixels.w = w; }, get width() { return pixels.w; },
    set height(h) { pixels.h = h; pixels.dados = new Uint8ClampedArray(pixels.w * h * 4); }, get height() { return pixels.h; },
    getContext() { return ctx2d; }
  };
  const ctx = {
    console, URLSearchParams, Uint8Array, Math, JSON, Date,
    location: { origin: 'https://ilhas-de-tinta.vercel.app', pathname: '/', search: '' },
    devicePixelRatio: 2,
    crypto: require('crypto').webcrypto,
    document: { querySelector() { return null; } },
    localStorage: comArmazenamento
      ? { getItem: (k) => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = String(v); }, removeItem: (k) => { delete guardado[k]; } }
      : { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('window.IlhasDeTinta = { CORES_JOGADORES: { rosa: {}, azul: {}, amarelo: {}, roxo: {} } };', ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/vendor/qrcode-generator-1.4.4.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/turma.js'), 'utf8'), ctx);
  return { T: ctx.IlhasDeTinta.turma, canvas, pixels };
}

const { T, canvas, pixels } = mundo(true);

// Ids
const ids = new Set();
for (let i = 0; i < 2000; i++) ids.add(T.criarId('Gatinhas 🐱'));
const um = [...ids][0];
ok(ids.size === 2000, '2000 ids sorteados, todos diferentes');
ok([...ids].every((id) => T.valido(id) && /^gatinhas-[2-9a-hjkmnp-z]{5}$/.test(id)), 'formato apelido-xxxxx sem 0/o/1/l/i: ' + um);
ok(T.apelido('Princesas Mágicas!') === 'princesasmagicas' && T.apelido('🐱🐶') === 'turma', 'apelido sem acento/emoji (vazio vira "turma")');
ok(!T.valido('gatinhas') && !T.valido('gatinhas-12') && !T.valido('Gatinhas-abcde') && !T.valido('a-b0c1d'), 'ids incompletos ou com letras ambíguas são recusados');
ok(T.link(um) === 'https://ilhas-de-tinta.vercel.app/?turma=' + um, 'link da turma: ' + T.link(um));

// Lista, nome e cor
T.lembrar(um, 'Gatinhas');
T.lembrar('dino-k7m2x', 'Dino');
ok(T.lista().map((t) => t.id).join() === 'dino-k7m2x,' + um, 'turmas lembradas (a última usada primeiro)');
ok(T.nomeDe(um) === 'Gatinhas' && T.nomeDe('flor-abcde') === 'Flor', 'nome da turma: o salvo, ou o apelido com maiúscula');
T.esquecer('dino-k7m2x');
ok(T.lista().length === 1, 'tirar uma turma da lista');
T.salvarNome('  Bia  '); T.salvarCor('roxo'); T.salvarCor('verde');
ok(T.nome() === 'Bia' && T.cor() === 'roxo', 'nome e cor lembrados (cor inválida é ignorada)');
const semArmazenamento = mundo(false).T;
let semErro = true;
try { semArmazenamento.lembrar(um, 'X'); semArmazenamento.salvarNome('Y'); semArmazenamento.salvarCor('rosa'); } catch (e) { semErro = false; }
ok(semErro && semArmazenamento.lista().length === 0 && semArmazenamento.nome() === '' && semArmazenamento.cor() === null, 'sem localStorage (bloqueado): não quebra');

// QR: desenha com o código do jogo e lê com o jsQR
for (const link of [T.link(um), 'https://ilhas-de-tinta.vercel.app/?sala=4821', T.link('princesasmagicas-abcde')]) {
  T.desenharQR(canvas, link, 280);
  const r = jsQR(pixels.dados, pixels.w, pixels.h);
  ok(r && r.data === link, 'QR (' + pixels.w + ' px) lido de volta: ' + (r ? r.data : 'nada'));
}
console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
process.exit(falhas ? 1 : 0);

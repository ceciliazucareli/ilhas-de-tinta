#!/usr/bin/env node
/*
 * grafico.js — desenha a evolução do treino em SVG (resultados/<cenario>/evolucao.svg).
 *   node tests/genetico/grafico.js --cenario 1x1
 * Dois painéis, cada um com um só eixo: aptidão por geração e % de vitórias por
 * geração (do melhor robô e a média da população). Passe o mouse num ponto para ver o valor.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const i = process.argv.indexOf('--cenario');
const cenario = i > 0 ? process.argv[i + 1] : '1x1';
const pasta = path.join(__dirname, 'resultados', cenario);
const h = JSON.parse(fs.readFileSync(path.join(pasta, 'historico.json'), 'utf8')).geracoes;

const L = 720, A = 250, M = { e: 56, d: 110, t: 40, b: 36 };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function painel(y0, titulo, series, dominio, formato, ticks) {
  const w = L - M.e - M.d, ph = A - M.t - M.b;
  const x = (g) => M.e + (h.length > 1 ? (g / (h.length - 1)) * w : 0);
  const y = (v) => y0 + M.t + ph - ((v - dominio[0]) / (dominio[1] - dominio[0])) * ph;
  let s = `<text class="titulo" x="${M.e}" y="${y0 + 22}">${esc(titulo)}</text>`;
  ticks.forEach((t) => {
    s += `<line class="grade" x1="${M.e}" x2="${M.e + w}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text class="eixo" x="${M.e - 8}" y="${y(t) + 4}" text-anchor="end">${formato(t)}</text>`;
  });
  const passo = Math.max(1, Math.ceil(h.length / 10 / 5) * 5);
  for (let g = 0; g < h.length; g += passo) s += `<text class="eixo" x="${x(g)}" y="${y0 + M.t + ph + 18}" text-anchor="middle">${g}</text>`;
  series.forEach((se) => {
    const pts = h.map((l, g) => [x(g), y(se.valor(l))]);
    s += `<polyline class="${se.classe}" fill="none" stroke-width="2" stroke-linejoin="round" points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`;
    pts.forEach((p, g) => {
      s += `<circle class="alvo" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6"><title>geração ${g} — ${esc(se.nome)}: ${formato(se.valor(h[g]))}</title></circle>`;
    });
    const ult = pts[pts.length - 1];
    s += `<circle class="${se.classe}-ponto" cx="${ult[0].toFixed(1)}" cy="${ult[1].toFixed(1)}" r="4"/>`;
    s += `<text class="rotulo" x="${ult[0] + 10}" y="${ult[1] + 4 + (se.desloca || 0)}">${esc(se.nome)} ${formato(se.valor(h[h.length - 1]))}</text>`;
  });
  return s;
}

const vals = h.flatMap((l) => [l.melhor, l.media]);
const lo = Math.floor(Math.min(...vals) * 4) / 4, hi = Math.ceil(Math.max(...vals) * 4) / 4;
const ticksA = []; for (let t = lo; t <= hi + 1e-9; t += (hi - lo) / 4) ticksA.push(+t.toFixed(2));
const ultimo = h[h.length - 1];
const separa = Math.abs(ultimo.melhor - ultimo.media) < 0.08 ? 7 : 0;
const separaV = Math.abs(ultimo.vitoriasDoMelhor - ultimo.vitoriasMedia) < 0.08 ? 7 : 0;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${A * 2 + 40}" width="${L}" height="${A * 2 + 40}" font-family="system-ui, sans-serif">
<style>
  svg { --fundo: #fcfcfb; --texto: #0b0b0b; --texto2: #52514e; --grade: #e4e3df; --s1: #2a78d6; --s2: #eb6834; }
  @media (prefers-color-scheme: dark) { svg { --fundo: #1a1a19; --texto: #f0efec; --texto2: #c3c2b7; --grade: #353533; --s1: #3987e5; --s2: #d95926; } }
  .fundo { fill: var(--fundo); }
  .titulo { fill: var(--texto); font-size: 14px; font-weight: 600; }
  .eixo, .legenda { fill: var(--texto2); font-size: 11px; }
  .rotulo { fill: var(--texto); font-size: 11px; }
  .grade { stroke: var(--grade); stroke-width: 1; }
  .melhor { stroke: var(--s1); } .media { stroke: var(--s2); }
  .melhor-ponto { fill: var(--s1); stroke: var(--fundo); stroke-width: 2; }
  .media-ponto { fill: var(--s2); stroke: var(--fundo); stroke-width: 2; }
  .alvo { fill: transparent; }
</style>
<rect class="fundo" width="100%" height="100%"/>
<g class="legenda">
  <line x1="${M.e}" x2="${M.e + 18}" y1="${A * 2 + 22}" y2="${A * 2 + 22}" stroke="var(--s1)" stroke-width="2"/><text class="legenda" x="${M.e + 24}" y="${A * 2 + 26}">melhor robô da geração</text>
  <line x1="${M.e + 180}" x2="${M.e + 198}" y1="${A * 2 + 22}" y2="${A * 2 + 22}" stroke="var(--s2)" stroke-width="2"/><text class="legenda" x="${M.e + 204}" y="${A * 2 + 26}">média da população</text>
  <text class="legenda" x="${L - M.d}" y="${A * 2 + 26}" text-anchor="end">geração →</text>
</g>
${painel(0, `Aptidão por geração — cenário ${cenario} contra a CPU Impossível 😈`, [
  { nome: 'melhor', classe: 'melhor', valor: (l) => l.melhor, desloca: ultimo.melhor >= ultimo.media ? -separa : separa },
  { nome: 'média', classe: 'media', valor: (l) => l.media, desloca: ultimo.melhor >= ultimo.media ? separa : -separa }
], [lo, hi], (v) => v.toFixed(2), ticksA)}
${painel(A, '% de vitórias nas partidas de treino da geração', [
  { nome: 'melhor', classe: 'melhor', valor: (l) => l.vitoriasDoMelhor, desloca: -separaV },
  { nome: 'média', classe: 'media', valor: (l) => l.vitoriasMedia, desloca: separaV }
], [0, 1], (v) => Math.round(v * 100) + '%', [0, 0.25, 0.5, 0.75, 1])}
</svg>
`;
fs.writeFileSync(path.join(pasta, 'evolucao.svg'), svg);
console.log('gravado', path.join(pasta, 'evolucao.svg'));

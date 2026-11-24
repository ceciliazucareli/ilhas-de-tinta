#!/usr/bin/env node
/*
 * ablacao.js — o que o campeão aprendeu? Tira um comportamento de cada vez e
 * mede quanto ele perde, nas mesmas partidas novas (sementes 8.000.000+).
 *   node tests/genetico/ablacao.js --cenario 1x1 [--partidas 60] [--workers 4]
 * Grava resultados/<cenario>/ablacao.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('./genetico');
const { criarPiscina } = require('./piscina');
const sim = require('./simulador');

const args = process.argv.slice(2);
const opcao = (n, p) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : p; };
const cenario = opcao('cenario', '1x1');
const N = +opcao('partidas', 60);
const pasta = path.join(__dirname, 'resultados', cenario);
const GENES = sim.criarMundo().IT.robo.GENES;
const idx = (nome) => GENES.findIndex((g) => g.nome === nome);
const valorGene = (nome, real) => { const g = GENES[idx(nome)]; return (real - g.min) / (g.max - g.min); };

async function main() {
  const campeao = JSON.parse(fs.readFileSync(path.join(pasta, 'campeao.json'), 'utf8'));
  const p = campeao.parametros;
  const troca = (mudancas) => {
    const g = campeao.genes.slice();
    Object.keys(mudancas).forEach((k) => { g[idx(k)] = valorGene(k, mudancas[k]); });
    return g;
  };
  const variantes = [
    ['campeão como está', {}],
    ['não caça (alcanceCaca 0)', { alcanceCaca: 0 }],
    ['sem margem de segurança (margem 0)', { margemSeguranca: 0 }],
    ['margem de segurança do Impossível (1)', { margemSeguranca: 1 }],
    ['nunca foge pelo perigo (margem -2)', { margemSeguranca: -2 }],
    ['voltas pequenas (prof. 3, lado 4, rastro 10)', { profundidadeMax: 3, larguraMax: 4, rastroMax: 10 }],
    ['rastro curto (rastroMax 12)', { rastroMax: 12 }],
    ['escolhe a 1ª volta (candidatos 1)', { candidatos: 1 }],
    ['roubar = grama (pesoRoubo 1)', { pesoRoubo: 1 }],
    ['medo do robô esperto (6)', { medo: 6 }],
    ['vigia o adversário (vigia 6)', { vigia: 6 }]
  ];
  const piscina = criarPiscina(+opcao('workers', 0) || undefined);
  const sementes = Array.from({ length: N }, (_, k) => 8000000 + k);
  const tarefas = [];
  variantes.forEach((v) => sementes.forEach((semente) => tarefas.push({ cenario, semente, genes: troca(v[1]) })));
  const rs = await piscina.jogar(tarefas);
  await piscina.fechar();
  const linhas = variantes.map((v, i) => {
    const meus = rs.slice(i * N, (i + 1) * N);
    const vit = meus.filter((r) => r.venceu).length;
    const media = (f) => meus.reduce((a, r) => a + f(r), 0) / N;
    return {
      variante: v[0], mudanca: v[1], vitorias: vit, partidas: N, ic95: G.wilson(vit, N).map((x) => +x.toFixed(3)),
      territorio: +media((r) => r.pctRobo).toFixed(3), adversario: +media((r) => r.pctMelhorOutro).toFixed(3),
      cortado: +media((r) => r.rastroCortado).toFixed(2), cortes: +media((r) => r.cortesDoRobo).toFixed(2)
    };
  });
  fs.writeFileSync(path.join(pasta, 'ablacao.json'), JSON.stringify({ cenario, parametrosDoCampeao: p, sementes: '8000000..', linhas }, null, 1));
  console.log(`ablação ${cenario} (${N} partidas cada):`);
  linhas.forEach((l) => console.log(`  ${l.variante.padEnd(46)} vence ${String(l.vitorias).padStart(3)}/${N}  território ${(100 * l.territorio).toFixed(1)}% × ${(100 * l.adversario).toFixed(1)}%  cortado ${l.cortado}  cortes ${l.cortes}`));
}
main().catch((e) => { console.error(e); process.exit(1); });

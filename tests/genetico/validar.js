#!/usr/bin/env node
/*
 * validar.js — mede o campeão em partidas NUNCA vistas no treino (sementes 9.000.000+).
 *   node tests/genetico/validar.js --cenario 1x1 [--partidas 100]
 *
 * Compara, nas MESMAS partidas, com robôs fixos (mesma velocidade de gente):
 *   esperto   = voltas curtas, volta quando alguém chega perto (tests/simulacao.html)
 *   cuidadoso = cérebro da CPU Médio
 *   sem treino = robô genético com todos os genes no meio (0,5)
 * e mede também o Impossível com a CPU Difícil no lugar do J1 (referência:
 * quanto o Impossível ganha de outra CPU). Taxa de vitória com intervalo de
 * confiança de Wilson (95%). Grava resultados/<cenario>/validacao.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('./genetico');
const { criarPiscina } = require('./piscina');

const args = process.argv.slice(2);
const opcao = (n, p) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : p; };
const cenario = opcao('cenario', '1x1');
const N = +opcao('partidas', 100);
const pasta = path.join(__dirname, 'resultados', cenario);

async function main() {
  const campeao = JSON.parse(fs.readFileSync(path.join(pasta, 'campeao.json'), 'utf8'));
  const sementes = Array.from({ length: N }, (_, k) => 9000000 + k);
  const competidores = [
    { nome: 'campeão (genético)', cfg: { genes: campeao.genes } },
    { nome: 'robô esperto', cfg: { perfil: 'esperto' } },
    { nome: 'robô cuidadoso', cfg: { perfil: 'cuidadoso' } },
    { nome: 'robô sem treino (genes 0,5)', cfg: { genes: Array(campeao.genes.length).fill(0.5) } },
    { nome: 'CPU Difícil no lugar do J1', cfg: { perfil: 'cpuDificil' } }
  ];
  const piscina = criarPiscina();
  const tarefas = [];
  competidores.forEach((c) => sementes.forEach((semente) => tarefas.push(Object.assign({ cenario, semente }, c.cfg))));
  const t0 = Date.now();
  const rs = await piscina.jogar(tarefas);
  await piscina.fechar();
  const linhas = competidores.map((c, i) => {
    const meus = rs.slice(i * N, (i + 1) * N);
    const v = meus.filter((r) => r.venceu).length;
    const media = (f) => meus.reduce((a, r) => a + f(r), 0) / N;
    const ic = G.wilson(v, N);
    return {
      robo: c.nome, partidas: N, vitorias: v, empates: meus.filter((r) => r.empate).length,
      taxa: +(v / N).toFixed(3), ic95: ic.map((x) => +x.toFixed(3)),
      territorioMedio: +media((r) => r.pctRobo).toFixed(3),
      territorioMedioDoMelhorAdversario: +media((r) => r.pctMelhorOutro).toFixed(3),
      rastroCortadoPorPartida: +media((r) => r.rastroCortado).toFixed(2),
      cortesFeitosPorPartida: +media((r) => r.cortesDoRobo).toFixed(2),
      terminouAntesDoTempo: meus.filter((r) => r.passos < 7200).length
    };
  });
  const saida = { cenario, sementes: '9000000..' + (9000000 + N - 1), segundos: Math.round((Date.now() - t0) / 1000), resultados: linhas };
  fs.writeFileSync(path.join(pasta, 'validacao.json'), JSON.stringify(saida, null, 1));
  console.log(`validação ${cenario}: ${N} partidas novas por robô (${saida.segundos} s)`);
  linhas.forEach((l) => console.log(`  ${l.robo.padEnd(30)} vence ${String(l.vitorias).padStart(3)}/${N} = ${(100 * l.taxa).toFixed(0).padStart(3)}%  [IC95 ${(100 * l.ic95[0]).toFixed(0)}–${(100 * l.ic95[1]).toFixed(0)}%]  território ${(100 * l.territorioMedio).toFixed(1)}% × ${(100 * l.territorioMedioDoMelhorAdversario).toFixed(1)}%  cortado ${l.rastroCortadoPorPartida}/partida`));
}
main().catch((e) => { console.error(e); process.exit(1); });

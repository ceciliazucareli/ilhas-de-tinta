/*
 * Testes da captura de área (grid.js).
 * Abra tests/captura.html no navegador: o resultado aparece na página.
 *
 * Cada caso desenha um mapa em texto:
 *   .        grama livre
 *   1 2 3 4  território do jogador 1, 2, 3 ou 4
 *   a b c d  rastro do jogador 1, 2, 3 ou 4 (sobre grama livre)
 *   A B C D  rastro do jogador 1, 2, 3 ou 4 sobre território do jogador 2
 * A captura é sempre feita pelo jogador 1 (a não ser que o caso diga outro id).
 */
(function () {
'use strict';
var Grade = window.IlhasDeTinta.Grade;
var saida = [];
function log(t) { saida.push(t); }

function deTexto(linhas) {
  var g = new Grade(linhas[0].length, linhas.length);
  linhas.forEach(function (l, y) {
    for (var x = 0; x < l.length; x++) {
      var ch = l[x];
      if (ch >= '1' && ch <= '4') g.setDono(x, y, +ch);
      else if (ch >= 'a' && ch <= 'd') g.setRastro(x, y, ch.charCodeAt(0) - 96);
      else if (ch >= 'A' && ch <= 'D') { g.setDono(x, y, 2); g.setRastro(x, y, ch.charCodeAt(0) - 64); }
    }
  });
  return g;
}

function paraTexto(g) {
  var out = [];
  for (var y = 0; y < g.linhas; y++) {
    var l = '';
    for (var x = 0; x < g.colunas; x++) {
      var r = g.rastro(x, y), d = g.dono(x, y);
      if (r) l += d === 2 ? String.fromCharCode(64 + r) : String.fromCharCode(96 + r);
      else l += d ? String(d) : '.';
    }
    out.push(l);
  }
  return out;
}

var falhas = 0;
function caso(nome, antes, esperado, id) {
  var g = deTexto(antes);
  g.capturar(id || 1);
  var obtido = paraTexto(g);
  if (obtido.join('\n') === esperado.join('\n')) {
    log('ok   - ' + nome);
  } else {
    falhas++;
    log('FALHA - ' + nome + '\nesperado:\n' + esperado.join('\n') + '\nobtido:\n' + obtido.join('\n'));
  }
}

caso('área simples (retângulo)', [
  '........',
  '.aaaa...',
  '.a..a...',
  '.a..a...',
  '.111a...',
  '........'
], [
  '........',
  '.1111...',
  '.1111...',
  '.1111...',
  '.1111...',
  '........'
]);

caso('forma em L', [
  '.........',
  '.aaa.....',
  '.a.a.....',
  '.a.aaaa..',
  '.a....a..',
  '.111111..',
  '.........'
], [
  '.........',
  '.111.....',
  '.111.....',
  '.111111..',
  '.111111..',
  '.111111..',
  '.........'
]);

caso('captura que encosta na borda', [
  'aaaa....',
  'a..a....',
  'a..a....',
  '1111....',
  '........'
], [
  '1111....',
  '1111....',
  '1111....',
  '1111....',
  '........'
]);

// A borda do mapa NÃO funciona como parede: a área aberta para a borda
// continua livre e só o rastro vira território.
caso('área aberta para a borda não é capturada', [
  '....a...',
  '....a...',
  '....a...',
  'aaaa1...',
  '........'
], [
  '....1...',
  '....1...',
  '....1...',
  '11111...',
  '........'
]);

caso('rastro sem fechar área só vira território', [
  '........',
  '.11aaa..',
  '.11.....',
  '........'
], [
  '........',
  '.11111..',
  '.11.....',
  '........'
]);

// ---- Vários jogadores ----

caso('toma território do jogador 2 que ficou cercado', [
  '.........',
  '.aaaaa...',
  '.a222a...',
  '.a22.a...',
  '.11111...',
  '.........'
], [
  '.........',
  '.11111...',
  '.11111...',
  '.11111...',
  '.11111...',
  '.........'
]);

caso('rastro por cima do território do jogador 2 vira do jogador 1', [
  '..2222..',
  '..AAAA..',
  '..A22A..',
  '..1111..'
], [
  '..2222..',
  '..1111..',
  '..1111..',
  '..1111..'
]);

caso('território de outro não é parede: área ligada à borda por ele fica livre', [
  '..2.....',
  '.a2a....',
  '.a.a....',
  '.111....'
], [
  '..2.....',
  '.121....',
  '.1.1....',
  '.111....'
]);

caso('rastro de outro jogador dentro da área continua lá', [
  '.......',
  '.aaaa..',
  '.a.ba..',
  '.a..a..',
  '.1111..'
], [
  '.......',
  '.1111..',
  '.11b1..',
  '.1111..',
  '.1111..'
]);

caso('captura do jogador 3 não mexe no jogador 1', [
  '11.....',
  '11ccc..',
  '..c.c..',
  '..333..'
], [
  '11.....',
  '11333..',
  '..333..',
  '..333..'
], 3);

// Contagem e fração por jogador.
var g = deTexto(['11..', '2...']);
if (g.fracao(1) !== 0.25 || g.contar(2) !== 1) { falhas++; log('FALHA - fração/contagem por jogador'); }
else log('ok   - fração e contagem por jogador');

// Limpar rastro só apaga o rastro daquele jogador.
g = deTexto(['abab']);
g.limparRastro(1);
if (paraTexto(g)[0] !== '.b.b') { falhas++; log('FALHA - limparRastro'); }
else log('ok   - limpar rastro só do jogador certo');

// Busca de caminho desviando de bloqueios.
g = deTexto(['1.a.', '..a.', '....']);
var caminho = g.buscarCaminho(3, 0,
  function (x, y) { return g.dono(x, y) === 1; },
  function (x, y) { return g.rastro(x, y) === 1; });
if (!caminho || caminho.length !== 7) { falhas++; log('FALHA - buscarCaminho: ' + JSON.stringify(caminho)); }
else log('ok   - busca de caminho desvia do rastro');

log(falhas ? falhas + ' falha(s)' : 'Todos os testes passaram.');
window.resultadoTestes = { falhas: falhas, texto: saida.join('\n') };
document.getElementById('saida').textContent = saida.join('\n');
document.body.className = falhas ? 'falhou' : 'passou';
})();

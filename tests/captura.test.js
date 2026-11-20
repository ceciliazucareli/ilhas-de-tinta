/*
 * Testes da captura de área (grid.js).
 * Abra tests/captura.html no navegador: o resultado aparece na página.
 * Cada caso desenha um mapa em texto:  . vazio   # território   r rastro
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
      g.set(x, y, l[x] === '#' ? Grade.TERRITORIO : l[x] === 'r' ? Grade.RASTRO : Grade.VAZIO);
    }
  });
  return g;
}
function paraTexto(g) {
  var out = [];
  for (var y = 0; y < g.linhas; y++) {
    var l = '';
    for (var x = 0; x < g.colunas; x++) {
      var v = g.get(x, y);
      l += v === Grade.TERRITORIO ? '#' : v === Grade.RASTRO ? 'r' : '.';
    }
    out.push(l);
  }
  return out;
}

var falhas = 0;
function caso(nome, antes, esperado) {
  var g = deTexto(antes);
  g.capturar();
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
  '.rrrr...',
  '.r..r...',
  '.r..r...',
  '.###r...',
  '........'
], [
  '........',
  '.####...',
  '.####...',
  '.####...',
  '.####...',
  '........'
]);

caso('forma em L', [
  '.........',
  '.rrr.....',
  '.r.r.....',
  '.r.rrrr..',
  '.r....r..',
  '.######..',
  '.........'
], [
  '.........',
  '.###.....',
  '.###.....',
  '.######..',
  '.######..',
  '.######..',
  '.........'
]);

caso('captura que encosta na borda', [
  'rrrr....',
  'r..r....',
  'r..r....',
  '####....',
  '........'
], [
  '####....',
  '####....',
  '####....',
  '####....',
  '........'
]);

// A borda do mapa NÃO funciona como parede: a área aberta para a borda
// continua livre e só o rastro vira território.
caso('área aberta para a borda não é capturada', [
  '....r...',
  '....r...',
  '....r...',
  'rrrr#...',
  '........'
], [
  '....#...',
  '....#...',
  '....#...',
  '#####...',
  '........'
]);

caso('rastro sem fechar área só vira território', [
  '........',
  '.##rrr..',
  '.##.....',
  '........'
], [
  '........',
  '.#####..',
  '.##.....',
  '........'
]);

caso('fração conquistada', ['##..'], ['##..']);
var g = deTexto(['##..']);
if (g.fracaoConquistada() !== 0.5) { falhas++; log('FALHA - fracaoConquistada'); }

log(falhas ? falhas + ' falha(s)' : 'Todos os testes passaram.');
window.resultadoTestes = { falhas: falhas, texto: saida.join('\n') };
document.getElementById('saida').textContent = saida.join('\n');
document.body.className = falhas ? 'falhou' : 'passou';
})();

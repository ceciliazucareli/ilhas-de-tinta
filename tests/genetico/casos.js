/* Partidas de conferência (usadas por conferir.html no navegador e conferir.js no Node). */
(function (raiz) {
  var IMPOSSIVEL = { tipo: 'cpu', cor: 'azul', nome: 'CPU Impossível', dificuldade: 'desafio' };
  var DIFICIL = { tipo: 'cpu', cor: 'amarelo', nome: 'CPU Difícil', dificuldade: 'dificil' };
  var MEDIO = { tipo: 'cpu', cor: 'roxo', nome: 'CPU Médio', dificuldade: 'medio' };
  raiz.CENARIOS_CONFERIR = { '1x1': [IMPOSSIVEL], '3j': [IMPOSSIVEL, DIFICIL], '4j': [IMPOSSIVEL, DIFICIL, MEDIO] };
  var meio = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  var outro = [0.2, 0.8, 0.9, 0.3, 0.6, 0.4, 0.7, 0.1, 0.9, 0.6, 0.8, 0.2, 0.3, 0.5];
  raiz.CASOS_CONFERIR = [
    { cenario: '1x1', semente: 1, genes: meio },
    { cenario: '1x1', semente: 2, perfil: 'esperto' },
    { cenario: '1x1', semente: 3, genes: outro },
    { cenario: '3j', semente: 4, genes: outro },
    { cenario: '4j', semente: 5, perfil: 'esperto' },
    { cenario: '4j', semente: 6, genes: meio }
  ];
})(typeof window !== 'undefined' ? window : module.exports);

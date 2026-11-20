/*
 * config.js — constantes do jogo.
 * Todo o jogo vive no namespace global "IlhasDeTinta" (abreviado como IT
 * dentro de cada arquivo) para funcionar com <script> clássicos em file://.
 */
window.IlhasDeTinta = window.IlhasDeTinta || {};

(function (IT) {
  'use strict';

  IT.config = {
    COLUNAS: 30,          // largura da grade, em células
    LINHAS: 20,           // altura da grade, em células
    CELULA: 28,           // tamanho de cada célula em pixels
    MARGEM: 18,           // espaço em volta da ilha dentro do canvas
    VELOCIDADE: 7,        // células por segundo
    TERRITORIO_INICIAL: 3, // lado do quadrado inicial (3x3)
    META: 0.8,            // fração do mapa para vencer (80%)

    CORES: {
      gramaClara: '#b8ec8a',
      gramaEscura: '#a6e077',
      bordaIlha: '#7cc35a',
      terra: '#c99a6b',
      terraEscura: '#a87a50',
      tinta: '#ff7eb6',
      tintaClara: '#ffb3d4',
      tintaEscura: '#e2589a',
      rastro: '#ff9cc8',
      sombra: 'rgba(40, 60, 90, 0.18)'
    }
  };

  /* Direções possíveis (dx, dy). */
  IT.DIRECOES = {
    cima: { x: 0, y: -1 },
    baixo: { x: 0, y: 1 },
    esquerda: { x: -1, y: 0 },
    direita: { x: 1, y: 0 }
  };

  /* Direção oposta, usada para impedir meia-volta de 180°. */
  IT.OPOSTA = { cima: 'baixo', baixo: 'cima', esquerda: 'direita', direita: 'esquerda' };
})(window.IlhasDeTinta);

/*
 * grid.js — estado do mapa.
 * Cada célula guarda um destes valores:
 *   VAZIO      grama ainda não conquistada
 *   TERRITORIO área pintada pelo jogador
 *   RASTRO     tinta fresca deixada fora do território
 */
(function (IT) {
  'use strict';

  var VAZIO = 0, TERRITORIO = 1, RASTRO = 2;

  function Grade(colunas, linhas) {
    this.colunas = colunas;
    this.linhas = linhas;
    this.celulas = new Uint8Array(colunas * linhas);
  }

  Grade.VAZIO = VAZIO;
  Grade.TERRITORIO = TERRITORIO;
  Grade.RASTRO = RASTRO;

  Grade.prototype.dentro = function (x, y) {
    return x >= 0 && y >= 0 && x < this.colunas && y < this.linhas;
  };

  Grade.prototype.get = function (x, y) {
    return this.celulas[y * this.colunas + x];
  };

  Grade.prototype.set = function (x, y, valor) {
    this.celulas[y * this.colunas + x] = valor;
  };

  /* Pinta um quadrado de território centrado em (cx, cy). */
  Grade.prototype.pintarQuadrado = function (cx, cy, lado) {
    var meio = Math.floor(lado / 2);
    for (var y = cy - meio; y < cy - meio + lado; y++) {
      for (var x = cx - meio; x < cx - meio + lado; x++) {
        if (this.dentro(x, y)) this.set(x, y, TERRITORIO);
      }
    }
  };

  IT.Grade = Grade;
})(window.IlhasDeTinta);

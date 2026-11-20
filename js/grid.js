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

  /* Apaga todo o rastro (vira grama de novo). Usado na penalidade. */
  Grade.prototype.limparRastro = function () {
    for (var i = 0; i < this.celulas.length; i++) {
      if (this.celulas[i] === RASTRO) this.celulas[i] = VAZIO;
    }
  };

  Grade.prototype.temRastro = function () {
    for (var i = 0; i < this.celulas.length; i++) {
      if (this.celulas[i] === RASTRO) return true;
    }
    return false;
  };

  /*
   * Captura de área, chamada quando o explorador volta ao território.
   * 1) Todo rastro vira território.
   * 2) Flood fill (busca em largura) a partir das bordas do mapa, andando
   *    só por células que NÃO são território.
   * 3) Toda célula não-território que o flood fill não alcançou está
   *    cercada pelo território: ela também vira território.
   * Devolve quantas células novas foram conquistadas.
   */
  Grade.prototype.capturar = function () {
    var w = this.colunas, h = this.linhas, c = this.celulas;
    var ganhas = 0, i;

    for (i = 0; i < c.length; i++) {
      if (c[i] === RASTRO) { c[i] = TERRITORIO; ganhas++; }
    }

    var alcancada = new Uint8Array(c.length);
    var fila = new Int32Array(c.length);
    var ini = 0, fim = 0;

    function semear(x, y) {
      var k = y * w + x;
      if (!alcancada[k] && c[k] !== TERRITORIO) { alcancada[k] = 1; fila[fim++] = k; }
    }

    for (var x = 0; x < w; x++) { semear(x, 0); semear(x, h - 1); }
    for (var y = 0; y < h; y++) { semear(0, y); semear(w - 1, y); }

    while (ini < fim) {
      var k = fila[ini++];
      var kx = k % w, ky = (k - kx) / w;
      if (kx > 0) semear(kx - 1, ky);
      if (kx < w - 1) semear(kx + 1, ky);
      if (ky > 0) semear(kx, ky - 1);
      if (ky < h - 1) semear(kx, ky + 1);
    }

    for (i = 0; i < c.length; i++) {
      if (!alcancada[i] && c[i] !== TERRITORIO) { c[i] = TERRITORIO; ganhas++; }
    }
    return ganhas;
  };

  /* Fração do mapa (0 a 1) que já é território. */
  Grade.prototype.fracaoConquistada = function () {
    var n = 0;
    for (var i = 0; i < this.celulas.length; i++) {
      if (this.celulas[i] === TERRITORIO) n++;
    }
    return n / this.celulas.length;
  };

  IT.Grade = Grade;
})(window.IlhasDeTinta);

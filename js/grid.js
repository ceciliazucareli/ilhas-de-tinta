/*
 * grid.js — estado do mapa para 1 a 4 jogadores.
 * Cada célula guarda duas informações independentes:
 *   dono   → id do jogador dono do território (0 = grama livre, 1..4 = jogador)
 *   rastro → id do jogador cujo rastro de tinta está ali (0 = sem rastro)
 * Uma célula pode ser território de um jogador e ter o rastro de outro por cima
 * (quando alguém passeia pelo território alheio).
 */
(function (IT) {
  'use strict';

  function Grade(colunas, linhas) {
    this.colunas = colunas;
    this.linhas = linhas;
    this.total = colunas * linhas;
    this.donos = new Uint8Array(this.total);
    this.rastros = new Uint8Array(this.total);
  }

  Grade.prototype.dentro = function (x, y) {
    return x >= 0 && y >= 0 && x < this.colunas && y < this.linhas;
  };

  Grade.prototype.indice = function (x, y) { return y * this.colunas + x; };

  Grade.prototype.dono = function (x, y) { return this.donos[y * this.colunas + x]; };
  Grade.prototype.setDono = function (x, y, id) { this.donos[y * this.colunas + x] = id; };

  Grade.prototype.rastro = function (x, y) { return this.rastros[y * this.colunas + x]; };
  Grade.prototype.setRastro = function (x, y, id) { this.rastros[y * this.colunas + x] = id; };

  /* Pinta um quadrado de território do jogador "id" centrado em (cx, cy). */
  Grade.prototype.pintarQuadrado = function (cx, cy, lado, id) {
    var meio = Math.floor(lado / 2);
    for (var y = cy - meio; y < cy - meio + lado; y++) {
      for (var x = cx - meio; x < cx - meio + lado; x++) {
        if (this.dentro(x, y)) {
          this.setDono(x, y, id);
          this.setRastro(x, y, 0);
        }
      }
    }
  };

  /* Apaga o rastro de um jogador (vira o que havia embaixo). Usado na penalidade. */
  Grade.prototype.limparRastro = function (id) {
    for (var i = 0; i < this.total; i++) {
      if (this.rastros[i] === id) this.rastros[i] = 0;
    }
  };

  Grade.prototype.tamanhoRastro = function (id) {
    var n = 0;
    for (var i = 0; i < this.total; i++) if (this.rastros[i] === id) n++;
    return n;
  };

  Grade.prototype.temRastro = function (id) {
    for (var i = 0; i < this.total; i++) if (this.rastros[i] === id) return true;
    return false;
  };

  /*
   * Captura de área do jogador "id", chamada quando ele volta ao próprio território.
   * 1) Todo o rastro dele vira território dele.
   * 2) Flood fill (busca em largura) a partir das bordas do mapa, andando só por
   *    células que NÃO são território dele (território de outros não é parede).
   * 3) Toda célula que não é dele e que o flood fill não alcançou está cercada:
   *    vira território dele — inclusive se era território de outro jogador.
   * Devolve quantas células ele ganhou.
   */
  Grade.prototype.capturar = function (id) {
    var w = this.colunas, h = this.linhas, donos = this.donos, rastros = this.rastros;
    var ganhas = 0, i;

    for (i = 0; i < this.total; i++) {
      if (rastros[i] === id) {
        rastros[i] = 0;
        if (donos[i] !== id) { donos[i] = id; ganhas++; }
      }
    }

    var alcancada = new Uint8Array(this.total);
    var fila = new Int32Array(this.total);
    var ini = 0, fim = 0;

    function semear(x, y) {
      var k = y * w + x;
      if (!alcancada[k] && donos[k] !== id) { alcancada[k] = 1; fila[fim++] = k; }
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

    for (i = 0; i < this.total; i++) {
      if (!alcancada[i] && donos[i] !== id) { donos[i] = id; ganhas++; }
    }
    return ganhas;
  };

  Grade.prototype.contar = function (id) {
    var n = 0;
    for (var i = 0; i < this.total; i++) if (this.donos[i] === id) n++;
    return n;
  };

  /* Fração do mapa (0 a 1) que é território do jogador "id". */
  Grade.prototype.fracao = function (id) {
    return this.contar(id) / this.total;
  };

  /*
   * Busca em largura a partir de (x, y) até a célula mais próxima que satisfaça
   * "objetivo(x, y)", sem passar por células onde "bloqueada(x, y)" é verdade.
   * Devolve o caminho [{x,y}, ...] sem a célula inicial, ou null.
   */
  Grade.prototype.buscarCaminho = function (x, y, objetivo, bloqueada) {
    var w = this.colunas, inicio = y * w + x;
    var anterior = new Int32Array(this.total).fill(-1);
    var fila = new Int32Array(this.total);
    var ini = 0, fim = 0;
    anterior[inicio] = inicio;
    fila[fim++] = inicio;
    var VIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (ini < fim) {
      var k = fila[ini++];
      var kx = k % w, ky = (k - kx) / w;
      if (k !== inicio && objetivo(kx, ky)) {
        var caminho = [];
        while (k !== inicio) { caminho.unshift({ x: k % w, y: Math.floor(k / w) }); k = anterior[k]; }
        return caminho;
      }
      for (var d = 0; d < 4; d++) {
        var nx = kx + VIZ[d][0], ny = ky + VIZ[d][1];
        if (!this.dentro(nx, ny)) continue;
        var nk = ny * w + nx;
        if (anterior[nk] !== -1 || bloqueada(nx, ny)) continue;
        anterior[nk] = k;
        fila[fim++] = nk;
      }
    }
    return null;
  };

  IT.Grade = Grade;
})(window.IlhasDeTinta);

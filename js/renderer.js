/*
 * renderer.js — desenha tudo no canvas: ilha, grama, território, rastro
 * e o explorador.
 */
(function (IT) {
  'use strict';

  var C = IT.config;
  var ctx = null;
  var canvas = null;

  /* Converte coordenada de célula para pixel (canto superior esquerdo). */
  function px(celula) { return C.MARGEM + celula * C.CELULA; }

  function retanguloArredondado(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function desenharIlha(grade) {
    var largura = grade.colunas * C.CELULA;
    var altura = grade.linhas * C.CELULA;
    var x0 = C.MARGEM, y0 = C.MARGEM;

    // Parte de baixo da ilha flutuante (terra).
    ctx.fillStyle = C.CORES.terraEscura;
    ctx.beginPath();
    ctx.moveTo(x0 + 10, y0 + altura);
    ctx.quadraticCurveTo(x0 + largura / 2, y0 + altura + 70, x0 + largura - 10, y0 + altura);
    ctx.closePath();
    ctx.fill();
    retanguloArredondado(x0 - 4, y0 + 8, largura + 8, altura + 14, 22);
    ctx.fillStyle = C.CORES.terra;
    ctx.fill();

    // Base de grama.
    retanguloArredondado(x0 - 6, y0 - 6, largura + 12, altura + 12, 22);
    ctx.fillStyle = C.CORES.bordaIlha;
    ctx.fill();
  }

  function desenharCelulas(grade) {
    var G = IT.Grade;
    for (var y = 0; y < grade.linhas; y++) {
      for (var x = 0; x < grade.colunas; x++) {
        var v = grade.get(x, y);
        if (v === G.VAZIO) {
          ctx.fillStyle = (x + y) % 2 === 0 ? C.CORES.gramaClara : C.CORES.gramaEscura;
          ctx.fillRect(px(x), px(y), C.CELULA, C.CELULA);
        } else if (v === G.TERRITORIO) {
          ctx.fillStyle = (x + y) % 2 === 0 ? C.CORES.tinta : C.CORES.tintaClara;
          ctx.fillRect(px(x), px(y), C.CELULA, C.CELULA);
        } else if (v === G.RASTRO) {
          ctx.fillStyle = (x + y) % 2 === 0 ? C.CORES.gramaClara : C.CORES.gramaEscura;
          ctx.fillRect(px(x), px(y), C.CELULA, C.CELULA);
          ctx.fillStyle = C.CORES.rastro;
          retanguloArredondado(px(x) + 5, px(y) + 5, C.CELULA - 10, C.CELULA - 10, 7);
          ctx.fill();
        }
      }
    }
  }

  function desenharExplorador(explorador, tempo) {
    var pos = explorador.posicaoVisual();
    var cx = px(pos.x) + C.CELULA / 2;
    var cy = px(pos.y) + C.CELULA / 2;
    var pulo = explorador.andando() ? Math.abs(Math.sin(tempo * 14)) * 3 : 0;
    var r = C.CELULA * 0.38;

    // Sombra no chão.
    ctx.fillStyle = C.CORES.sombra;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    cy -= pulo + 3;

    // Corpo (rosto redondo).
    ctx.fillStyle = '#ffd9b3';
    ctx.strokeStyle = '#d9a173';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Olhos olham para a direção do movimento.
    var d = IT.DIRECOES[explorador.ultimaDirecao];
    ctx.fillStyle = '#3b2a20';
    ctx.beginPath();
    ctx.arc(cx - 3.5 + d.x * 2.5, cy + 1 + d.y * 2, 1.8, 0, Math.PI * 2);
    ctx.arc(cx + 3.5 + d.x * 2.5, cy + 1 + d.y * 2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Chapéu de explorador (aba + copa + fita).
    ctx.fillStyle = '#e8b04a';
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.55, r * 1.25, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.85, r * 0.7, r * 0.55, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = C.CORES.tintaEscura;
    ctx.fillRect(cx - r * 0.7, cy - r * 0.78, r * 1.4, 3);
  }

  IT.renderer = {
    iniciar: function (elementoCanvas, grade) {
      canvas = elementoCanvas;
      canvas.width = grade.colunas * C.CELULA + C.MARGEM * 2;
      canvas.height = grade.linhas * C.CELULA + C.MARGEM * 2 + 60;
      ctx = canvas.getContext('2d');
    },

    desenhar: function (grade, explorador, tempo) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      desenharIlha(grade);
      desenharCelulas(grade);
      desenharExplorador(explorador, tempo);
    }
  };
})(window.IlhasDeTinta);

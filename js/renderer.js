/*
 * renderer.js — desenha tudo no canvas: ilha flutuante, grama com flores e
 * árvores, território pintado de cada jogador, rastros de tinta, os
 * exploradores e o confete do fim. Nenhuma imagem externa: só formas simples.
 *
 * Câmera: o canvas ocupa toda a área de jogo da tela.
 *   - Se o mapa inteiro cabe com células de bom tamanho (desktop), mostra tudo.
 *   - Em tela pequena (celular), a câmera SEGUE o explorador deste aparelho com
 *     células grandes (28–40 px) e aparece um minimapa no canto.
 * Só as células visíveis são desenhadas, e o canvas usa devicePixelRatio
 * (no máximo 2) para ficar nítido sem pesar no celular.
 */
(function (IT) {
  'use strict';

  var C = IT.config;
  var ctx = null;
  var canvas = null;

  var decoracoes = [];      // flores e árvores espalhadas pela grama
  var estadoAnterior = null; // cópia da grade do quadro anterior
  var pintadoEm = null;      // momento em que cada célula virou território
  var confetes = [];
  var cel = C.CELULA;        // tamanho da célula desta partida (muda com o mapa)
  var coresPorId = [];       // paleta de cada jogador, indexada pelo id

  /* Câmera. Coordenadas do "mundo" = as mesmas de px(); escala = px de tela por unidade. */
  var cam = { x: 0, y: 0, escala: 1, seguindo: false, pronta: false };
  var tela = { w: 0, h: 0, dpr: 1 };              // tamanho do canvas em px CSS
  var vista = { x0: 0, y0: 0, x1: 0, y1: 0 };      // células visíveis (inclusive)
  var mundo = { w: 0, h: 0 };
  var minimapa = { canvas: null, atualizadoEm: -1 };
  var casaDestacada = 0;          // tutorial: id do jogador cuja casa pisca (0 = nenhuma)
  var CELULA_MINIMA_TELA = 22;    // toque: abaixo disso (mapa inteiro), a câmera passa a seguir
  var CELULA_MINIMA_DESKTOP = 15; // mouse/teclado: só segue em janelas bem pequenas

  /* Converte coordenada de célula para pixel (canto superior esquerdo). */
  function px(celula) { return C.MARGEM + celula * cel; }

  /* Gerador pseudoaleatório com semente, para a decoração ser estável. */
  function aleatorio(semente) {
    return function () {
      semente = (semente * 1664525 + 1013904223) % 4294967296;
      return semente / 4294967296;
    };
  }

  function retanguloArredondado(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- Ilha ---------- */

  function desenharIlha(grade) {
    var largura = grade.colunas * cel;
    var altura = grade.linhas * cel;
    var x0 = C.MARGEM, y0 = C.MARGEM;

    // Rochas penduradas embaixo da ilha flutuante.
    ctx.fillStyle = C.CORES.terraEscura;
    ctx.beginPath();
    ctx.moveTo(x0 + 20, y0 + altura);
    var pontas = [[0.12, 34], [0.24, 18], [0.36, 52], [0.5, 66], [0.63, 44], [0.76, 58], [0.88, 24]];
    pontas.forEach(function (p) { ctx.lineTo(x0 + largura * p[0], y0 + altura + p[1]); });
    ctx.lineTo(x0 + largura - 20, y0 + altura);
    ctx.closePath();
    ctx.fill();

    // Camada de terra.
    retanguloArredondado(x0 - 4, y0 + 10, largura + 8, altura + 16, 22);
    ctx.fillStyle = C.CORES.terra;
    ctx.fill();

    // Borda de grama em volta do mapa.
    retanguloArredondado(x0 - 7, y0 - 7, largura + 14, altura + 14, 22);
    ctx.fillStyle = C.CORES.bordaIlha;
    ctx.fill();
  }

  /* ---------- Células ---------- */

  function desenharGrama(x, y) {
    ctx.fillStyle = (x + y) % 2 === 0 ? C.CORES.gramaClara : C.CORES.gramaEscura;
    ctx.fillRect(px(x), px(y), cel, cel);
  }

  function desenharCelulas(grade, tempo) {
    var t = cel;
    var x, y, k, dono;

    var X0 = vista.x0, X1 = vista.x1, Y0 = vista.y0, Y1 = vista.y1; // só o que aparece

    // 1) Grama em todo lugar que não é território de ninguém.
    for (y = Y0; y <= Y1; y++) {
      for (x = X0; x <= X1; x++) {
        if (grade.dono(x, y) === 0) desenharGrama(x, y);
      }
    }

    // 2) Decoração só na grama livre e sem rastro.
    decoracoes.forEach(function (d) {
      if (d.x < X0 || d.x > X1 || d.y < Y0 || d.y > Y1) return;
      if (grade.dono(d.x, d.y) === 0 && grade.rastro(d.x, d.y) === 0) desenharDecoracao(d, tempo);
    });

    // 3) Território: cada célula "cresce" rapidinho ao ser pintada.
    for (y = Y0; y <= Y1; y++) {
      for (x = X0; x <= X1; x++) {
        k = y * grade.colunas + x;
        dono = grade.donos[k];
        if (dono === 0) continue;
        var cores = coresPorId[dono];
        var idade = Math.max(0, tempo - pintadoEm[k]);
        var escala = Math.min(1, 0.4 + idade * 4);
        var lado = t * escala, folga = (t - lado) / 2;
        ctx.fillStyle = (x + y) % 2 === 0 ? cores.tinta : cores.clara;
        if (escala < 1) {
          desenharGrama(x, y);
          retanguloArredondado(px(x) + folga, px(y) + folga, lado, lado, 6);
          ctx.fill();
        } else {
          ctx.fillRect(px(x), px(y), t, t);
        }
      }
    }

    // 4) Contorno de cada território onde ele encontra outra coisa.
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (var id = 1; id < coresPorId.length; id++) {
      var mesmo = function (a, b) { return grade.dentro(a, b) && grade.dono(a, b) === id; };
      ctx.strokeStyle = coresPorId[id].escura;
      ctx.beginPath();
      for (y = Y0; y <= Y1; y++) {
        for (x = X0; x <= X1; x++) {
          if (grade.dono(x, y) !== id) continue;
          if (!mesmo(x, y - 1)) { ctx.moveTo(px(x), px(y)); ctx.lineTo(px(x + 1), px(y)); }
          if (!mesmo(x, y + 1)) { ctx.moveTo(px(x), px(y + 1)); ctx.lineTo(px(x + 1), px(y + 1)); }
          if (!mesmo(x - 1, y)) { ctx.moveTo(px(x), px(y)); ctx.lineTo(px(x), px(y + 1)); }
          if (!mesmo(x + 1, y)) { ctx.moveTo(px(x + 1), px(y)); ctx.lineTo(px(x + 1), px(y + 1)); }
        }
      }
      ctx.stroke();
    }

    // 5) Rastros: gotas de tinta que pulsam de leve, na cor de cada jogador.
    for (y = Y0; y <= Y1; y++) {
      for (x = X0; x <= X1; x++) {
        var dono_rastro = grade.rastro(x, y);
        if (dono_rastro === 0) continue;
        var cr = coresPorId[dono_rastro];
        var pulso = 1 + Math.sin(tempo * 6 + (x + y) * 0.6) * 0.08;
        var r = t * 0.34 * pulso;
        ctx.fillStyle = cr.escura;
        ctx.beginPath();
        ctx.arc(px(x) + t / 2, px(y) + t / 2, r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cr.rastro;
        ctx.beginPath();
        ctx.arc(px(x) + t / 2, px(y) + t / 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(px(x) + t / 2 - r * 0.35, px(y) + t / 2 - r * 0.35, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ---------- Decoração ---------- */

  function desenharDecoracao(d, tempo) {
    var cx = px(d.x) + cel / 2 + d.dx;
    var cy = px(d.y) + cel / 2 + d.dy;
    var esc = cel / C.CELULA; // decoração encolhe junto com a célula
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(esc, esc);
    ctx.translate(-cx, -cy);
    if (d.tipo === 'flor') {
      var balanco = Math.sin(tempo * 2 + d.fase) * 1.2;
      ctx.fillStyle = d.cor;
      for (var i = 0; i < 5; i++) {
        var a = i * Math.PI * 2 / 5 + d.fase;
        ctx.beginPath();
        ctx.arc(cx + balanco + Math.cos(a) * 3.6, cy + Math.sin(a) * 3.6, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(cx + balanco, cy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.tipo === 'arvore') {
      ctx.fillStyle = C.CORES.sombra;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 9, 9, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9c6b3f';
      ctx.fillRect(cx - 2.5, cy, 5, 9);
      ctx.fillStyle = '#5fbf4a';
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7fd665';
      ctx.beginPath();
      ctx.arc(cx - 3, cy - 7, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else { // tufo de grama
      ctx.strokeStyle = '#86c95e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy + 3); ctx.lineTo(cx - 5, cy - 3);
      ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy - 5);
      ctx.moveTo(cx + 4, cy + 3); ctx.lineTo(cx + 5, cy - 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- Explorador ---------- */

  /*
   * Desenha o explorador do jogador "j". No modo multi a mochila tem a cor do
   * jogador e aparece uma etiqueta com o nome acima do chapéu.
   */
  function desenharExplorador(j, tempo, modo) {
    var explorador = j.explorador;
    var pos = explorador.posicaoVisual();
    var cx = px(pos.x) + cel / 2;
    var cy = px(pos.y) + cel / 2;
    var andando = explorador.andando();
    var pulo = andando ? Math.abs(Math.sin(tempo * 14 + j.id)) * 3 : Math.sin(tempo * 3 + j.id) * 0.8;
    // No mapa grande o explorador fica um pouco maior que a célula, para ser fácil de achar.
    var r = Math.max(cel * 0.38, 9.5);
    var olho = r / 10.6;

    // Sombra no chão.
    ctx.fillStyle = C.CORES.sombra;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.95, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    cy -= pulo + 3;

    // Mochila atrás (verde no solo; cor do jogador no multi).
    ctx.fillStyle = modo === 'solo' ? '#4fb39a' : j.cor.escura;
    retanguloArredondado(cx - r * 0.75, cy - r * 0.1, r * 1.5, r * 1.1, 4);
    ctx.fill();

    // Rosto redondo.
    ctx.fillStyle = '#ffd9b3';
    ctx.strokeStyle = '#d9a173';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Bochechas rosadas.
    ctx.fillStyle = 'rgba(255, 126, 182, 0.45)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.55, cy + r * 0.35, 2.4 * olho, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.55, cy + r * 0.35, 2.4 * olho, 0, Math.PI * 2);
    ctx.fill();

    // Olhos olham para a direção do movimento.
    var d = IT.DIRECOES[explorador.ultimaDirecao];
    ctx.fillStyle = '#3b2a20';
    ctx.beginPath();
    ctx.arc(cx + (-3.5 + d.x * 2.5) * olho, cy + (1 + d.y * 2) * olho, 1.8 * olho, 0, Math.PI * 2);
    ctx.arc(cx + (3.5 + d.x * 2.5) * olho, cy + (1 + d.y * 2) * olho, 1.8 * olho, 0, Math.PI * 2);
    ctx.fill();

    // Chapéu de explorador (aba + copa + fita rosa).
    ctx.fillStyle = '#e8b04a';
    ctx.strokeStyle = '#c98f2e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.55, r * 1.25, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.7, r * 0.7, r * 0.65, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = j.cor.escura;
    ctx.fillRect(cx - r * 0.7, cy - r * 0.82, r * 1.4, 3);

    if (modo === 'multi') desenharEtiqueta(j.nome, cx, cy - r * 1.55, j.cor.escura);

    // Desafio 😈 caçando alguém: aviso bem visível, para dar tempo de fugir.
    if (j.cacando) {
      var balanco = Math.sin(tempo * 10) * 2;
      ctx.font = Math.round(r * 1.5) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('😈', cx + r * 1.35, cy - r * 0.9 + balanco);
    }
  }

  /* Plaquinha com o nome do jogador, para saber quem é quem. */
  function desenharEtiqueta(texto, cx, base, cor) {
    ctx.font = 'bold 11px ui-rounded, "Nunito", "Trebuchet MS", sans-serif';
    var w = ctx.measureText(texto).width + 10;
    var x = Math.max(2, Math.min(mundo.w - w - 2, cx - w / 2));
    retanguloArredondado(x, base - 15, w, 15, 7);
    ctx.fillStyle = cor;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, x + w / 2, base - 7.2);
  }



  /* ---------- Confete da vitória ---------- */

  function soltarConfete() {
    var cores = ['#ff7eb6', '#ffe066', '#7cd1ff', '#8be07a', '#c59bff'];
    confetes = [];
    for (var i = 0; i < 140; i++) {
      confetes.push({
        x: Math.random() * tela.w,
        y: -Math.random() * tela.h,
        vy: 60 + Math.random() * 90,
        giro: Math.random() * Math.PI * 2,
        cor: cores[i % cores.length]
      });
    }
  }

  function desenharConfete(dt) {
    confetes.forEach(function (c) {
      c.y += c.vy * dt;
      c.giro += dt * 5;
      if (c.y > tela.h) c.y = -10; // cai em loop enquanto a tela de vitória está aberta
      ctx.save();
      ctx.translate(c.x + Math.sin(c.giro) * 6, c.y);
      ctx.rotate(c.giro);
      ctx.fillStyle = c.cor;
      ctx.fillRect(-4, -2.5, 8, 5);
      ctx.restore();
    });
  }

  /* ---------- API pública ---------- */

  /* Tutorial: contorno pulsando em volta da casa e uma casinha pulando em cima. */
  function desenharCasaDestacada(grade, tempo) {
    var x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (var y = 0; y < grade.linhas; y++) {
      for (var x = 0; x < grade.colunas; x++) {
        if (grade.dono(x, y) !== casaDestacada) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return;
    var pulso = (Math.sin(tempo * 6) + 1) / 2;
    var folga = 4 + pulso * 6;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 + pulso * 0.4) + ')';
    ctx.setLineDash([10, 8]);
    retanguloArredondado(px(x0) - folga, px(y0) - folga, (x1 - x0 + 1) * cel + 2 * folga, (y1 - y0 + 1) * cel + 2 * folga, 12);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = Math.round(cel * 1.1) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('🏠', px((x0 + x1 + 1) / 2), px(y1 + 1) + cel * 1.3 + Math.sin(tempo * 5) * 4);
    ctx.restore();
  }

  /* ---------- Câmera ---------- */

  /* Ajusta o canvas ao tamanho dele na tela (com devicePixelRatio até 2). */
  function ajustarTamanho() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (w !== tela.w || h !== tela.h || dpr !== tela.dpr) {
      tela.w = w; tela.h = h; tela.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
  }

  /* O explorador que a câmera segue: o único humano que joga neste aparelho. */
  function quemSeguir(jogadores) {
    var locais = jogadores.filter(function (j) { return j.tipo === 'humano' && j.local; });
    return locais.length === 1 ? locais[0] : null;
  }

  function atualizarCamera(grade, jogadores, dt) {
    var ajuste = Math.min(tela.w / mundo.w, tela.h / mundo.h);
    var foco = quemSeguir(jogadores);
    // Em aparelho de toque a câmera segue antes (dedo precisa de células maiores).
    var toque = document.body.classList.contains('toque');
    var seguir = !!foco && ajuste * cel < (toque ? CELULA_MINIMA_TELA : CELULA_MINIMA_DESKTOP);

    var alvoX, alvoY, escala;
    if (seguir) {
      var celTela = Math.max(28, Math.min(40, Math.min(tela.w, tela.h) / 11));
      escala = celTela / cel;
      var pos = foco.explorador.posicaoVisual();
      alvoX = px(pos.x) + cel / 2;
      alvoY = px(pos.y) + cel / 2;
      // Não deixa a câmera mostrar céu demais além da ilha.
      var meiaW = tela.w / (2 * escala), meiaH = tela.h / (2 * escala), folga = cel * 1.5;
      alvoX = mundo.w + 2 * folga <= 2 * meiaW ? mundo.w / 2 : Math.max(meiaW - folga, Math.min(mundo.w - meiaW + folga, alvoX));
      alvoY = mundo.h + 2 * folga <= 2 * meiaH ? mundo.h / 2 : Math.max(meiaH - folga, Math.min(mundo.h - meiaH + folga, alvoY));
    } else {
      escala = ajuste;
      alvoX = mundo.w / 2;
      alvoY = mundo.h / 2;
    }

    if (!cam.pronta || seguir !== cam.seguindo) {
      cam.x = alvoX; cam.y = alvoY; cam.pronta = true;
    } else {
      // Movimento suave (amortecido), independente da taxa de quadros.
      var k = 1 - Math.exp(-dt * 9);
      cam.x += (alvoX - cam.x) * k;
      cam.y += (alvoY - cam.y) * k;
    }
    cam.escala = escala;
    cam.seguindo = seguir;

    // Células visíveis (com uma de folga).
    var meiaLarg = tela.w / (2 * escala), meiaAlt = tela.h / (2 * escala);
    vista.x0 = Math.max(0, Math.floor((cam.x - meiaLarg - C.MARGEM) / cel) - 1);
    vista.x1 = Math.min(grade.colunas - 1, Math.ceil((cam.x + meiaLarg - C.MARGEM) / cel) + 1);
    vista.y0 = Math.max(0, Math.floor((cam.y - meiaAlt - C.MARGEM) / cel) - 1);
    vista.y1 = Math.min(grade.linhas - 1, Math.ceil((cam.y + meiaAlt - C.MARGEM) / cel) + 1);
  }

  /* ---------- Minimapa (só quando a câmera não mostra o mapa todo) ---------- */

  function desenharMinimapa(grade, jogadores, tempo) {
    var largura = Math.round(Math.min(130, tela.w * 0.3));
    var lado = largura / grade.colunas;
    var altura = Math.round(lado * grade.linhas);
    var margemInferior = (IT.ui && IT.ui.margemMinimapa) ? IT.ui.margemMinimapa() : 10;
    var x0 = 10, y0 = tela.h - altura - margemInferior;

    // A imagem das células é refeita no máximo 5 vezes por segundo.
    if (!minimapa.canvas) minimapa.canvas = document.createElement('canvas');
    var mc = minimapa.canvas;
    if (mc.width !== grade.colunas || mc.height !== grade.linhas || tempo - minimapa.atualizadoEm > 0.2 || tempo < minimapa.atualizadoEm) {
      mc.width = grade.colunas; mc.height = grade.linhas;
      var mctx = mc.getContext('2d');
      var img = mctx.createImageData(grade.colunas, grade.linhas);
      var grama = [184, 236, 138];
      for (var i = 0; i < grade.total; i++) {
        var cor = grama, d = grade.donos[i], r = grade.rastros[i];
        if (r) cor = hexParaRgb(coresPorId[r].escura);
        else if (d) cor = hexParaRgb(coresPorId[d].tinta);
        img.data[i * 4] = cor[0]; img.data[i * 4 + 1] = cor[1]; img.data[i * 4 + 2] = cor[2]; img.data[i * 4 + 3] = 255;
      }
      mctx.putImageData(img, 0, 0);
      minimapa.atualizadoEm = tempo;
    }

    ctx.save();
    ctx.setTransform(tela.dpr, 0, 0, tela.dpr, 0, 0);
    retanguloArredondado(x0 - 4, y0 - 4, largura + 8, altura + 8, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(mc, x0, y0, largura, altura);
    ctx.globalAlpha = 1;

    // Retângulo do que a câmera está mostrando.
    var meiaLarg = tela.w / (2 * cam.escala), meiaAlt = tela.h / (2 * cam.escala);
    var vx = (cam.x - meiaLarg - C.MARGEM) / cel, vy = (cam.y - meiaAlt - C.MARGEM) / cel;
    ctx.strokeStyle = 'rgba(58,63,99,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + Math.max(0, vx) * lado, y0 + Math.max(0, vy) * lado,
      Math.min(grade.colunas, 2 * meiaLarg / cel) * lado, Math.min(grade.linhas, 2 * meiaAlt / cel) * lado);

    // Exploradores (o deste aparelho com borda branca, maior).
    var foco = quemSeguir(jogadores);
    jogadores.forEach(function (j) {
      var p = j.explorador.posicaoVisual();
      ctx.beginPath();
      ctx.arc(x0 + (p.x + 0.5) * lado, y0 + (p.y + 0.5) * lado, j === foco ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = j.cor.escura;
      ctx.fill();
      if (j === foco) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    });
    ctx.restore();
  }

  var cacheRgb = {};
  function hexParaRgb(hex) {
    if (!cacheRgb[hex]) {
      var n = parseInt(hex.slice(1), 16);
      cacheRgb[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return cacheRgb[hex];
  }

  /* ---------- API pública ---------- */

  var ultimoTempo = 0;

  IT.renderer = {
    iniciar: function (elementoCanvas) {
      canvas = elementoCanvas;
      ctx = canvas.getContext('2d');
    },

    /* Prepara uma nova partida: decoração, animações e câmera. */
    novaPartida: function (grade, jogadores) {
      cel = C.TAMANHOS[jogadores.length].celula;
      mundo.w = grade.colunas * cel + C.MARGEM * 2;
      mundo.h = grade.linhas * cel + C.MARGEM * 2 + 70;
      cam.pronta = false;
      minimapa.atualizadoEm = -1;
      coresPorId = [null].concat(jogadores.map(function (j) { return j.cor; }));
      var rnd = aleatorio(Math.floor(Math.random() * 1e9));
      var cores = ['#ffffff', '#ffe066', '#c59bff', '#7cd1ff', '#ff9f7a'];
      decoracoes = [];
      for (var y = 0; y < grade.linhas; y++) {
        for (var x = 0; x < grade.colunas; x++) {
          if (grade.dono(x, y) !== 0) continue;
          var sorte = rnd();
          var tipo = sorte < 0.04 ? 'arvore' : sorte < 0.16 ? 'flor' : sorte < 0.24 ? 'tufo' : null;
          if (!tipo) continue;
          decoracoes.push({
            x: x, y: y, tipo: tipo,
            dx: (rnd() - 0.5) * 8 * cel / C.CELULA, dy: (rnd() - 0.5) * 8 * cel / C.CELULA,
            fase: rnd() * Math.PI * 2,
            cor: cores[Math.floor(rnd() * cores.length)]
          });
        }
      }
      estadoAnterior = new Uint8Array(grade.donos);
      pintadoEm = new Float64Array(grade.total).fill(-10); // já "crescidas"
      confetes = [];
    },

    soltarConfete: soltarConfete,

    desenhar: function (grade, jogadores, tempo, modo) {
      var dt = Math.min(0.05, tempo - (ultimoTempo || tempo));
      ultimoTempo = tempo;

      // Marca o momento em que cada célula mudou de dono (para animar).
      for (var i = 0; i < grade.total; i++) {
        if (grade.donos[i] !== 0 && grade.donos[i] !== estadoAnterior[i]) pintadoEm[i] = tempo;
        estadoAnterior[i] = grade.donos[i];
      }

      ajustarTamanho();
      atualizarCamera(grade, jogadores, dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var e = cam.escala * tela.dpr;
      ctx.setTransform(e, 0, 0, e, tela.dpr * (tela.w / 2 - cam.x * cam.escala), tela.dpr * (tela.h / 2 - cam.y * cam.escala));
      desenharIlha(grade);
      desenharCelulas(grade, tempo);
      if (casaDestacada) desenharCasaDestacada(grade, tempo);
      jogadores.forEach(function (j) { desenharExplorador(j, tempo, modo); });
      if (cam.seguindo) desenharMinimapa(grade, jogadores, tempo);
      if (confetes.length) {
        ctx.setTransform(tela.dpr, 0, 0, tela.dpr, 0, 0);
        desenharConfete(dt);
      }
    },

    /* Tutorial: faz a casa do jogador "id" piscar (0 desliga). */
    destacarCasa: function (id) { casaDestacada = id || 0; },

    /* Informações da câmera (usadas nos testes). */
    camera: function () {
      return { seguindo: cam.seguindo, celulaNaTela: cam.escala * cel, x: cam.x, y: cam.y, tela: tela };
    }
  };
})(window.IlhasDeTinta);

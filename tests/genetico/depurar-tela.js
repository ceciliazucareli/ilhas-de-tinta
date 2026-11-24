/*
 * depurar-tela.js — modo depuração OCULTO na tela (só com ?debug=1).
 *
 *   index.html?robo=campeao&debug=1            robô campeão (1x1) × Impossível
 *   index.html?robo=campeao&cenario=3j&debug=1 (ou 4j)
 *   index.html?debug=1                         jogo normal: mostra a CPU Impossível
 *   index.html?debug=1&quem=3                  ... ou o jogador 3
 *
 * Mostra o que o "cérebro" decidiu e por quê (registro de depuracao.js):
 *   - no mapa: volta planejada (retângulo tracejado), caminho de volta para casa
 *     (pontilhado), mira no ponto de corte, olho no ponto de vigia e a área de
 *     perigo (até onde os adversários chegam antes de eu voltar para casa);
 *   - balão em cima de quem está sendo seguido, com a frase da decisão;
 *   - painel (à direita; no celular, embaixo e recolhível) com uma linha por
 *     mudança de decisão. Tocar numa linha abre os números e o ranking das
 *     voltas e mostra a FOTO do mapa daquele momento;
 *   - pausa, 0,25×, 0,5×, 1×, avançar uma célula e "Baixar log (JSON)".
 * O jogo em si não muda: só lê o estado e desenha por cima.
 */
(function () {
  'use strict';
  var IT = window.IlhasDeTinta, jogo = IT.jogo, C = IT.config;
  var params = new URLSearchParams(location.search);
  var quem = +params.get('quem') || 0;
  var comRobo = !!params.get('robo');

  var registro = null;      // registro de depuração ligado agora
  var sujeitoAtual = null;
  var mostradas = 0;        // linhas já no painel
  var foto = null;          // entrada cuja foto está na tela (null = ao vivo)
  var escolhida = null;     // linha aberta
  var velocidade = 1;

  /* ---------- Estilo e painel ---------- */

  var css = document.createElement('style');
  css.textContent = [
    'body.depurando .palco { margin-right: 380px; }',
    '#depuracao { position: fixed; z-index: 50; top: 0; right: 0; bottom: 0; width: 380px; display: flex; flex-direction: column;',
    '  background: #fffdf8; color: #2f3350; border-left: 2px solid #e7e1d4; font: 13px/1.35 system-ui, sans-serif; }',
    '#depuracao button { font: inherit; border: 1px solid #d9d2c3; background: #fff; border-radius: 8px; padding: 4px 8px; cursor: pointer; color: inherit; }',
    '#depuracao button.ativo { background: #2f3350; color: #fff; border-color: #2f3350; }',
    '#depuracao .dep-topo { display: flex; align-items: center; gap: 6px; padding: 8px; border-bottom: 1px solid #eee6d6; flex-wrap: wrap; }',
    '#depuracao .dep-titulo { font-weight: 700; margin-right: auto; background: none; border: none; padding: 4px 2px; }',
    '#depuracao .dep-controles { display: flex; gap: 4px; flex-wrap: wrap; padding: 6px 8px; border-bottom: 1px solid #eee6d6; }',
    '#depuracao .dep-atual { padding: 8px; background: #f4efe3; min-height: 3.2em; }',
    '#depuracao .dep-atual small { color: #6b6f86; display: block; }',
    '#depuracao ol { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }',
    '#depuracao li { border-bottom: 1px solid #f0eadc; }',
    '#depuracao li > .dep-linha { display: grid; grid-template-columns: 50px 20px 1fr; gap: 4px; padding: 5px 8px; cursor: pointer; }',
    '#depuracao li > .dep-linha:hover { background: #f7f2e7; }',
    '#depuracao li.evento > .dep-linha { color: #6b6f86; }',
    '#depuracao li.aberta > .dep-linha { background: #fff1c9; }',
    '#depuracao .dep-t { color: #8a8ea3; font-variant-numeric: tabular-nums; }',
    '#depuracao .dep-num { color: #6b6f86; font-size: 12px; grid-column: 3; }',
    '#depuracao .dep-detalhe { padding: 4px 8px 10px 62px; font-size: 12px; }',
    '#depuracao table { border-collapse: collapse; width: 100%; margin-top: 4px; font-variant-numeric: tabular-nums; }',
    '#depuracao th, #depuracao td { text-align: left; padding: 2px 4px; border-bottom: 1px solid #eee6d6; vertical-align: top; }',
    '#depuracao tr.escolhida td { background: #e3f6d8; font-weight: 600; }',
    '#depuracao .dep-vazio { padding: 12px 8px; color: #8a8ea3; }',
    '@media (max-width: 760px) {',
    '  body.depurando .palco { margin-right: 0; height: calc(100% - var(--dep-altura, 46px)); }',
    '  #depuracao { top: auto; left: 0; width: auto; height: var(--dep-altura, 46px); border-left: none; border-top: 2px solid #e7e1d4; }',
    '  #depuracao.recolhido .dep-controles, #depuracao.recolhido ol { display: none; }',
    '  #depuracao.recolhido .dep-atual { padding: 0 8px 6px; min-height: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  #depuracao.recolhido .dep-atual small { display: none; }',
    '}'
  ].join('\n');
  document.head.appendChild(css);

  var painel = document.createElement('aside');
  painel.id = 'depuracao';
  painel.setAttribute('aria-label', 'Depuração: decisões do cérebro');
  painel.innerHTML =
    '<div class="dep-topo"><button class="dep-titulo" data-acao="recolher" title="Recolher/abrir">🐞 Decisões <span class="dep-seta">▾</span></button>' +
    '<button data-acao="vivo" hidden>▶ Ao vivo</button></div>' +
    '<div class="dep-controles">' +
    '<button data-vel="0" title="Pausa">⏸</button><button data-vel="0.25">0,25×</button><button data-vel="0.5">0,5×</button>' +
    '<button data-vel="1" class="ativo">1×</button><button data-acao="passo" title="Avançar uma célula">⏭ passo</button>' +
    '<button data-acao="baixar" title="Baixar o log desta partida">⬇ Baixar log (JSON)</button></div>' +
    '<div class="dep-atual">Esperando a partida…</div><ol></ol>';
  document.body.appendChild(painel);
  document.body.classList.add('depurando');
  var lista = painel.querySelector('ol'), atualEl = painel.querySelector('.dep-atual');
  var botaoVivo = painel.querySelector('[data-acao="vivo"]');
  var celular = window.matchMedia('(max-width: 760px)');

  function ajustarAltura() {
    var recolhido = painel.classList.contains('recolhido');
    document.body.style.setProperty('--dep-altura', recolhido ? '74px' : '46vh');
    painel.querySelector('.dep-seta').textContent = recolhido ? '▴' : '▾';
  }
  if (celular.matches) painel.classList.add('recolhido');
  ajustarAltura();

  function mudarVelocidade(v) {
    velocidade = v;
    jogo.escalaTempo = v;
    painel.querySelectorAll('[data-vel]').forEach(function (b) { b.classList.toggle('ativo', +b.getAttribute('data-vel') === v); });
  }

  /* Avança até o cérebro decidir de novo (uma célula). */
  function umPasso() {
    mudarVelocidade(0);
    verFoto(null);
    if (!registro || jogo.estado !== 'jogando') return;
    var alvo = registro.decisoes + 1, n = 0;
    while (registro.decisoes < alvo && n < 600 && jogo.estado === 'jogando') { jogo.passo(1 / 60); n++; }
  }

  function baixar() {
    if (!registro) return;
    var dados = registro.exportar({ url: location.search, cenario: params.get('cenario') || (comRobo ? '1x1' : null), robo: params.get('robo') || null });
    var blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'decisoes-' + (registro.sujeito.nome || 'cerebro').replace(/\W+/g, '-') + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  painel.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (b) {
      if (b.hasAttribute('data-vel')) { mudarVelocidade(+b.getAttribute('data-vel')); verFoto(null); }
      var acao = b.getAttribute('data-acao');
      if (acao === 'passo') umPasso();
      if (acao === 'baixar') baixar();
      if (acao === 'vivo') verFoto(null);
      if (acao === 'recolher') { painel.classList.toggle('recolhido'); ajustarAltura(); }
      return;
    }
    var linha = ev.target.closest('.dep-linha');
    if (linha) abrirLinha(linha.parentNode);
  });
  // Teclas (só no modo depuração): "." avança uma célula; Shift+B baixa o log.
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Period') { umPasso(); e.preventDefault(); }
    if (e.code === 'KeyB' && e.shiftKey) baixar();
  });

  /* ---------- Linhas do log ---------- */

  var ICONES = { casa: '🏠', sair: '🖌️', voltar: '↩️', cacar: '🎯', vigiar: '👁️' };
  function mmss(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1).replace('.', ',');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function numerosCurtos(e) {
    var n = e.numeros;
    if (!n) return '';
    var partes = ['rastro ' + n.rastro, 'casa ' + (n.casa === null ? '∞' : n.casa)];
    (n.adversarios || []).forEach(function (a) { partes.push(a.apelido + '→meu rastro ' + (a.passos === null ? '∞' : a.passos)); });
    if (n.rastro && n.limite !== null) partes.push('limite ' + String(Math.round(n.limite * 10) / 10).replace('.', ','));
    return partes.join(' · ');
  }

  function novaLinha(e) {
    var li = document.createElement('li');
    li.className = e.tipo === 'evento' ? 'evento' : 'decisao';
    li.entrada = e;
    li.innerHTML = '<div class="dep-linha"><span class="dep-t">' + mmss(e.t) + '</span><span>' +
      (e.tipo === 'evento' ? '•' : (ICONES[e.modo] || '•')) + '</span><span>' + esc(e.frase) + '</span>' +
      (e.tipo === 'decisao' ? '<span class="dep-num">' + esc(numerosCurtos(e)) + '</span>' : '') + '</div>';
    return li;
  }

  function tabelaVoltas(cands) {
    var h = '<table><tr><th>#</th><th>nota</th><th>volta</th><th>grama</th><th>roubo</th><th>risco</th></tr>';
    cands.forEach(function (v) {
      var roubo = v.roubo.map(function (r) { return r.casas + ' ' + r.de; }).join(', ') || '—';
      var risco = v.risco ? 'adversário a ' + v.adversarioMaisPerto + ' (< ' + String(v.raioDeRisco).replace('.', ',') + '): ×' + String(v.fatorRisco).replace('.', ',') : '—';
      h += '<tr class="' + (v.escolhida ? 'escolhida' : '') + '"><td>' + v.posicao + (v.escolhida ? ' ✓' : '') + '</td><td>' +
        String(v.nota).replace('.', ',') + '</td><td>' + v.largura + '×' + v.altura + ' ' + esc(v.direcao) + '</td><td>' + v.grama +
        '</td><td>' + esc(roubo) + '</td><td>' + esc(risco) + (v.borda !== undefined ? '<br>borda ' + String(v.borda).replace('.', ',') : '') + '</td></tr>';
    });
    return h + '</table>';
  }

  function detalhes(e) {
    var h = '';
    if (e.placar) h += '<div>Placar: ' + e.placar.map(function (p) { return esc(p.nome) + ' ' + String(p.pct).replace('.', ',') + '%'; }).join(' · ') + '</div>';
    if (e.tipo === 'decisao') {
      h += '<div>Modo: <b>' + esc(e.modo) + '</b> · motivo: <b>' + esc(e.motivo) + '</b>' + (e.direcao ? ' · direção: ' + esc(e.direcao) : '') + '</div>';
      var n = e.numeros || {};
      if (n.adversarios && n.adversarios.length) {
        h += '<table><tr><th>adversário</th><th>passos até meu rastro</th><th>chega antes?</th></tr>';
        n.adversarios.forEach(function (a) {
          var antes = a.passos !== null && n.limite !== null && a.tempo !== null && a.tempo <= n.limite;
          h += '<tr><td>' + esc(a.nome) + '</td><td>' + (a.passos === null ? '∞' : a.passos) + '</td><td>' + (antes ? 'sim (≤ ' + String(Math.round(n.limite * 10) / 10).replace('.', ',') + ')' : 'não') + '</td></tr>';
        });
        h += '</table><div>Eu até casa: ' + (n.casa === null ? '∞' : n.casa) + ' passos · margem ' + String(Math.round(n.folga * 100) / 100).replace('.', ',') + '</div>';
      }
      if (e.motivo === 'corte' && e.detalhe && e.detalhe.corte) {
        var c = e.detalhe.corte;
        h += '<div>Ponto de corte (' + c.x + ',' + c.y + ') ' + (c.onde === 'caminho' ? 'no caminho de volta dele' : 'no rastro dele') + ': eu chego em ' + c.passos + ', ele em casa em ' + String(Math.round(c.tempoDele * 10) / 10).replace('.', ',') + '</div>';
      }
      if (e.candidatos) h += '<div style="margin-top:6px"><b>Voltas comparadas</b> (nota = grama + roubo × peso' + (e.candidatos[0] && e.candidatos[0].borda !== undefined ? ' + borda' : '') + ', × risco)</div>' + tabelaVoltas(e.candidatos);
    }
    return h;
  }

  function abrirLinha(li) {
    var aberta = li.classList.contains('aberta');
    lista.querySelectorAll('li.aberta').forEach(function (x) { x.classList.remove('aberta'); var d = x.querySelector('.dep-detalhe'); if (d) d.remove(); });
    if (aberta) { verFoto(null); return; }
    li.classList.add('aberta');
    var d = document.createElement('div');
    d.className = 'dep-detalhe';
    d.innerHTML = detalhes(li.entrada);
    li.appendChild(d);
    li.scrollIntoView({ block: 'start' });
    if (li.entrada.foto) { mudarVelocidade(0); verFoto(li.entrada); }
  }

  function verFoto(e) {
    foto = e;
    botaoVivo.hidden = !e;
    if (!e) lista.querySelectorAll('li.aberta').forEach(function (x) { x.classList.remove('aberta'); var d = x.querySelector('.dep-detalhe'); if (d) d.remove(); });
  }

  function atualizarPainel() {
    if (!registro) return;
    var perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    while (mostradas < registro.entradas.length) lista.appendChild(novaLinha(registro.entradas[mostradas++]));
    if (perto) lista.scrollTop = lista.scrollHeight;
    var a = registro.atual;
    if (a) atualEl.innerHTML = '<b>' + esc(registro.sujeito.nome) + '</b> ' + (ICONES[a.modo] || '') + ' ' + esc(a.frase) +
      '<small>' + mmss(a.t) + ' · ' + registro.decisoes + ' decisões · ' + registro.entradas.length + ' linhas' + (velocidade !== 1 ? ' · ' + (velocidade ? String(velocidade).replace('.', ',') + '×' : 'pausado') : '') + '</small>';
  }

  /* ---------- Quem seguir e ligar o registro ---------- */

  function escolherSujeito() {
    if (jogo.estado !== 'jogando' && jogo.estado !== 'fim') return null;
    var js = jogo.jogadores;
    if (quem) return js[quem - 1] && js[quem - 1].ia ? js[quem - 1] : null;
    if (comRobo) return js[0] && js[0].roboLigado ? js[0] : null;
    return js.filter(function (j) { return j.tipo === 'cpu' && j.dificuldade === 'desafio'; })[0] ||
      js.filter(function (j) { return j.ia; })[0] || null;
  }

  function vigiar() {
    var s = escolherSujeito();
    if (s && s.ia && !s.ia.depuracao && jogo.estado === 'jogando') {
      registro = IT.depuracao.ligar(jogo, s);
      sujeitoAtual = s;
      lista.innerHTML = '';
      mostradas = 0;
      verFoto(null);
    } else if (!registro && jogo.estado === 'jogando') {
      atualEl.textContent = 'Sem CPU nem robô para mostrar nesta partida (use ?robo=campeao ou jogue contra uma CPU).';
    }
    atualizarPainel();
    requestAnimationFrame(vigiar);
  }
  requestAnimationFrame(vigiar);
  // Para os testes (tests/genetico/teste_depuracao_tela.py).
  IT.depuracaoTela = { registro: function () { return registro; }, velocidade: mudarVelocidade, passo: umPasso, verFoto: verFoto };

  /* ---------- Desenho por cima do mapa ---------- */

  var canvas = document.getElementById('tela'), ctx = canvas.getContext('2d');
  var desenharOriginal = IT.renderer.desenhar;
  IT.renderer.desenhar = function (grade, jogadores) {
    desenharOriginal.apply(this, arguments);
    try { desenharDepuracao(grade, jogadores); } catch (erro) { console.error('depuração:', erro); }
  };

  function geometria(jogadores) {
    var cam = IT.renderer.camera(), cel = C.TAMANHOS[jogadores.length].celula, t = cam.tela;
    var escala = cam.celulaNaTela / cel;
    return {
      cel: cel, escala: escala, dpr: t.dpr, w: t.w, h: t.h,
      mundo: function () { ctx.setTransform(escala * t.dpr, 0, 0, escala * t.dpr, t.dpr * (t.w / 2 - cam.x * escala), t.dpr * (t.h / 2 - cam.y * escala)); },
      tela: function () { ctx.setTransform(t.dpr, 0, 0, t.dpr, 0, 0); },
      px: function (c) { return C.MARGEM + c * cel; },
      naTela: function (wx, wy) { return { x: t.w / 2 + (wx - cam.x) * escala, y: t.h / 2 + (wy - cam.y) * escala }; }
    };
  }

  function desenharDepuracao(grade, jogadores) {
    if (!registro || !sujeitoAtual || jogadores.indexOf(sujeitoAtual) < 0) return;
    var g = geometria(jogadores);
    ctx.save();
    g.mundo();
    var cor = sujeitoAtual.cor;
    if (foto) {
      desenharFoto(g, grade, jogadores, foto.foto);
      desenharMarcas(g, foto.foto.desenhos, cor, grade);
      var pf = foto.foto.jogadores.filter(function (p) { return p.id === sujeitoAtual.id; })[0];
      ctx.restore(); ctx.save();
      g.tela();
      faixa(g, '📷 Foto de ' + mmss(foto.t) + ' — toque em “▶ Ao vivo” para voltar');
      if (pf) balao(g, g.naTela(g.px(pf.x) + g.cel / 2, g.px(pf.y)), foto.frase);
    } else {
      var a = registro.atual;
      if (a) {
        desenharMarcas(g, a.desenhos, cor, grade);
        var pos = sujeitoAtual.explorador.posicaoVisual();
        ctx.restore(); ctx.save();
        g.tela();
        balao(g, g.naTela(g.px(pos.x) + g.cel / 2, g.px(pos.y) - g.cel * 0.6), a.frase);
        if (velocidade === 0) faixa(g, '⏸ Pausado — use ⏭ passo ou 1×');
      }
    }
    ctx.restore();
  }

  /* Volta planejada, caminho de casa, mira, vigia e área de perigo (coordenadas do mundo). */
  function desenharMarcas(g, d, cor, grade) {
    if (!d) return;
    var cel = g.cel, px = g.px, w = grade.colunas;
    if (d.perigo && d.perigo.length) {
      ctx.fillStyle = 'rgba(230, 40, 40, 0.16)';
      d.perigo.forEach(function (k) { ctx.fillRect(px(k % w), px(Math.floor(k / w)), cel, cel); });
      ctx.strokeStyle = 'rgba(200, 30, 30, 0.35)';
      ctx.lineWidth = 1;
      d.perigo.forEach(function (k) { ctx.strokeRect(px(k % w) + 0.5, px(Math.floor(k / w)) + 0.5, cel - 1, cel - 1); });
    }
    if (d.plano) {
      ctx.setLineDash([cel * 0.35, cel * 0.25]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(px(d.plano.x0) + 1, px(d.plano.y0) + 1, (d.plano.x1 - d.plano.x0 + 1) * cel - 2, (d.plano.y1 - d.plano.y0 + 1) * cel - 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = cor.escura;
      ctx.strokeRect(px(d.plano.x0) + 1, px(d.plano.y0) + 1, (d.plano.x1 - d.plano.x0 + 1) * cel - 2, (d.plano.y1 - d.plano.y0 + 1) * cel - 2);
      ctx.setLineDash([]);
    }
    if (d.caminhoCasa && d.caminhoCasa.length > 1) {
      ctx.lineCap = 'round';
      ctx.setLineDash([1, cel * 0.32]);
      ctx.lineWidth = Math.max(3, cel * 0.2);
      ctx.strokeStyle = '#2f3350';
      ctx.beginPath();
      d.caminhoCasa.forEach(function (c, i) {
        var x = px(c[0]) + cel / 2, y = px(c[1]) + cel / 2;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      var fim = d.caminhoCasa[d.caminhoCasa.length - 1];
      ctx.font = Math.round(cel * 0.7) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🏠', px(fim[0]) + cel / 2, px(fim[1]) + cel / 2);
    }
    if (d.mira) {
      var mx = px(d.mira[0]) + cel / 2, my = px(d.mira[1]) + cel / 2;
      ctx.strokeStyle = '#d11f3b'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(mx, my, cel * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, cel * 0.22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - cel * 0.8, my); ctx.lineTo(mx - cel * 0.3, my); ctx.moveTo(mx + cel * 0.3, my); ctx.lineTo(mx + cel * 0.8, my);
      ctx.moveTo(mx, my - cel * 0.8); ctx.lineTo(mx, my - cel * 0.3); ctx.moveTo(mx, my + cel * 0.3); ctx.lineTo(mx, my + cel * 0.8);
      ctx.stroke();
    }
    if (d.vigia) {
      ctx.font = Math.round(cel * 0.8) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👁️', px(d.vigia[0]) + cel / 2, px(d.vigia[1]) + cel / 2);
    }
  }

  /* Foto: o mapa daquele momento, em cores chapadas, por cima do mapa de agora. */
  function desenharFoto(g, grade, jogadores, f) {
    var cel = g.cel, px = g.px, w = grade.colunas, h = grade.linhas;
    if (f.donos.length !== w * h) return;
    ctx.fillStyle = '#9fdc7c';
    ctx.fillRect(px(0) - 4, px(0) - 4, w * cel + 8, h * cel + 8);
    for (var k = 0; k < w * h; k++) {
      var x = px(k % w), y = px(Math.floor(k / w));
      var dono = +f.donos[k], rastro = +f.rastros[k];
      if (dono) { ctx.fillStyle = jogadores[dono - 1].cor.tinta; ctx.fillRect(x, y, cel, cel); }
      if (rastro) {
        ctx.fillStyle = jogadores[rastro - 1].cor.rastro;
        ctx.fillRect(x + cel * 0.2, y + cel * 0.2, cel * 0.6, cel * 0.6);
        ctx.strokeStyle = jogadores[rastro - 1].cor.escura; ctx.lineWidth = 1.5;
        ctx.strokeRect(x + cel * 0.2, y + cel * 0.2, cel * 0.6, cel * 0.6);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    for (var i = 0; i <= w; i++) { ctx.beginPath(); ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(h)); ctx.stroke(); }
    for (var j = 0; j <= h; j++) { ctx.beginPath(); ctx.moveTo(px(0), px(j)); ctx.lineTo(px(w), px(j)); ctx.stroke(); }
    f.jogadores.forEach(function (p) {
      var jj = jogadores[p.id - 1];
      ctx.beginPath();
      ctx.arc(px(p.x) + cel / 2, px(p.y) + cel / 2, cel * 0.48, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd9b3'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = jj.cor.escura; ctx.stroke();
      ctx.fillStyle = jj.cor.escura;
      ctx.font = 'bold ' + Math.round(cel * 0.5) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(IT.depuracao.apelido(jj) === '😈' ? '😈' : String(p.id), px(p.x) + cel / 2, px(p.y) + cel / 2 + 1);
    });
  }

  /* Balão com a frase, acima de (p.x, p.y) em px de tela. Quebra em até 3 linhas. */
  function balao(g, p, texto) {
    if (!texto) return;
    ctx.font = '600 13px system-ui, sans-serif';
    var max = Math.min(280, g.w - 16), palavras = texto.split(' '), linhas = [], linha = '';
    palavras.forEach(function (pal) {
      var teste = linha ? linha + ' ' + pal : pal;
      if (ctx.measureText(teste).width > max - 16 && linha) { linhas.push(linha); linha = pal; } else linha = teste;
    });
    if (linha) linhas.push(linha);
    if (linhas.length > 3) { linhas = linhas.slice(0, 3); linhas[2] += '…'; }
    var larg = Math.max.apply(null, linhas.map(function (l) { return ctx.measureText(l).width; })) + 16;
    var alt = linhas.length * 17 + 10;
    var x = Math.max(8, Math.min(g.w - larg - 8, p.x - larg / 2));
    var y = p.y - alt - 12;
    var embaixo = y < 8;
    if (embaixo) y = p.y + 40;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.strokeStyle = '#2f3350';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var r = 9;
    ctx.moveTo(x + r, y); ctx.arcTo(x + larg, y, x + larg, y + alt, r); ctx.arcTo(x + larg, y + alt, x, y + alt, r);
    ctx.arcTo(x, y + alt, x, y, r); ctx.arcTo(x, y, x + larg, y, r); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // ponta do balão
    var px0 = Math.max(x + 12, Math.min(x + larg - 12, p.x));
    ctx.beginPath();
    if (embaixo) { ctx.moveTo(px0 - 6, y); ctx.lineTo(px0, y - 9); ctx.lineTo(px0 + 6, y); }
    else { ctx.moveTo(px0 - 6, y + alt); ctx.lineTo(px0, y + alt + 9); ctx.lineTo(px0 + 6, y + alt); }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2f3350';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    linhas.forEach(function (l, i) { ctx.fillText(l, x + 8, y + 6 + i * 17); });
  }

  function faixa(g, texto) {
    ctx.font = '600 13px system-ui, sans-serif';
    var larg = ctx.measureText(texto).width + 20;
    var x = (g.w - larg) / 2;
    ctx.fillStyle = 'rgba(47, 51, 80, 0.88)';
    ctx.beginPath();
    ctx.moveTo(x + 10, 6); ctx.arcTo(x + larg, 6, x + larg, 32, 10); ctx.arcTo(x + larg, 32, x, 32, 10);
    ctx.arcTo(x, 32, x, 6, 10); ctx.arcTo(x, 6, x + larg, 6, 10); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(texto, g.w / 2, 19.5);
  }
})();

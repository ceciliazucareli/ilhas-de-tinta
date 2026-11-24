/*
 * turma.js — turma fixa (link que não muda), lembrar nome/cor e QR code.
 *
 * TURMA: um link fixo como ?turma=gatinhas-k7m2x. O apelido vem do nome que a
 * criança escolheu; o final (5 letras/números sem os que se confundem, como
 * 0/o e 1/l) é sorteado, para ninguém de fora adivinhar. Abrir o link sempre
 * leva à MESMA sala (o canal do Supabase vem do id da turma; veja online.js).
 *
 * No aparelho (localStorage, sempre com try/catch) ficam só:
 *   ilhas-de-tinta:turmas  turmas já usadas [{ id, nome, usadaEm }]
 *   ilhas-de-tinta:nome    apelido
 *   ilhas-de-tinta:cor     cor preferida
 * Nada disso vai para servidor nenhum: o Supabase só repassa mensagens.
 *
 * QR: desenhado aqui mesmo (js/vendor/qrcode-generator-1.4.4.js), sem serviço externo.
 */
(function (IT) {
  'use strict';

  var CHAVE_TURMAS = 'ilhas-de-tinta:turmas';
  var CHAVE_NOME = 'ilhas-de-tinta:nome';
  var CHAVE_COR = 'ilhas-de-tinta:cor';
  var LETRAS = '23456789abcdefghjkmnpqrstuvwxyz'; // sem 0/o, 1/l/i
  var MAX_TURMAS = 8;

  function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
  function gravar(chave, valor) {
    try { if (valor === null) localStorage.removeItem(chave); else localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ }
  }

  /* "Gatinhas 🐱" → "gatinhas" (sem acento, só letras e números). */
  function apelido(nome) {
    var s = String(nome || '').normalize ? String(nome || '').normalize('NFD') : String(nome || '');
    s = s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
    return s || 'turma';
  }

  function sorteio(n) {
    var s = '', bytes = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var k = 0; k < n; k++) s += LETRAS[bytes[k] % LETRAS.length];
    return s;
  }

  function criarId(nome) { return apelido(nome) + '-' + sorteio(5); }

  /* Id de turma válido? (apelido-xxxxx, com 4 a 6 no final) */
  function valido(id) { return /^[a-z0-9]{1,16}-[2-9a-hjkmnp-z]{4,6}$/.test(String(id || '')); }

  /* Nome para mostrar: o salvo neste aparelho, ou o apelido com maiúscula. */
  function nomeDe(id) {
    var salva = lista().filter(function (t) { return t.id === id; })[0];
    if (salva && salva.nome) return salva.nome;
    var a = String(id).split('-')[0];
    return a.charAt(0).toUpperCase() + a.slice(1);
  }

  function base() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function link(id) { return base() + '?turma=' + id; }

  function lista() {
    try {
      var l = JSON.parse(ler(CHAVE_TURMAS) || '[]');
      return Array.isArray(l) ? l.filter(function (t) { return t && valido(t.id); }) : [];
    } catch (e) { return []; }
  }

  /* Guarda (ou atualiza) a turma no topo da lista deste aparelho. */
  function lembrar(id, nome) {
    if (!valido(id)) return;
    var l = lista().filter(function (t) { return t.id !== id; });
    var antiga = lista().filter(function (t) { return t.id === id; })[0];
    l.unshift({ id: id, nome: String(nome || (antiga && antiga.nome) || nomeDe(id)).slice(0, 20), usadaEm: Date.now() });
    gravar(CHAVE_TURMAS, JSON.stringify(l.slice(0, MAX_TURMAS)));
  }

  function esquecer(id) {
    gravar(CHAVE_TURMAS, JSON.stringify(lista().filter(function (t) { return t.id !== id; })));
  }

  /* ---------- Nome e cor lembrados ---------- */

  function nome() { return (ler(CHAVE_NOME) || '').slice(0, 12); }
  function salvarNome(n) { n = String(n || '').trim().slice(0, 12); if (n) gravar(CHAVE_NOME, n); }
  function cor() { var c = ler(CHAVE_COR); return c && IT.CORES_JOGADORES[c] ? c : null; }
  function salvarCor(c) { if (IT.CORES_JOGADORES[c]) gravar(CHAVE_COR, c); }

  /* ---------- QR code ---------- */

  /* Desenha o QR de "texto" num canvas, com "lado" px de CSS (nítido em tela retina). */
  function desenharQR(canvas, texto, lado) {
    var q = window.qrcode(0, 'M');
    q.addData(texto);
    q.make();
    var n = q.getModuleCount(), borda = 4;
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var celula = Math.max(2, Math.floor((lado * dpr) / (n + 2 * borda)));
    var total = celula * (n + 2 * borda);
    canvas.width = total; canvas.height = total;
    canvas.style.width = Math.round(total / dpr) + 'px';
    canvas.style.height = Math.round(total / dpr) + 'px';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, total, total);
    ctx.fillStyle = '#1f2340';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (q.isDark(y, x)) ctx.fillRect((x + borda) * celula, (y + borda) * celula, celula, celula);
      }
    }
    return { modulos: n, celula: celula };
  }

  /* ---------- "Adicionar à tela inicial" a partir do link da turma ---------- */

  /*
   * Aberto por ?turma=…: troca o manifest por um desta turma (start_url = link da
   * turma), para o ícone instalado/atalho abrir direto nela. Funciona no Chrome
   * (Android e computador); o Safari do iPhone usa o endereço da página.
   */
  function manifestDaTurma(id) {
    var tag = document.querySelector('link[rel="manifest"]');
    if (!tag || !window.Blob || !window.URL || !URL.createObjectURL) return;
    var b = base(), n = nomeDe(id);
    var icone = function (arq, tam, prop) { return { src: b + 'icones/' + arq, sizes: tam, type: 'image/png', purpose: prop }; };
    var m = {
      id: '/?turma=' + id,
      name: 'Ilhas de Tinta · turma ' + n,
      short_name: n.slice(0, 12),
      description: 'Ilhas de Tinta: jogar online com a turma ' + n + '.',
      lang: 'pt-BR',
      start_url: link(id),
      scope: b,
      display: 'standalone',
      orientation: 'any',
      background_color: '#c7ecff',
      theme_color: '#7ccfff',
      icons: [icone('icone-192.png', '192x192', 'any'), icone('icone-512.png', '512x512', 'any'),
        icone('icone-mascaravel-192.png', '192x192', 'maskable'), icone('icone-mascaravel-512.png', '512x512', 'maskable')]
    };
    tag.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
  }

  var daUrl = new URLSearchParams(location.search).get('turma');
  if (daUrl && valido(daUrl.toLowerCase())) manifestDaTurma(daUrl.toLowerCase());

  IT.turma = {
    criarId: criarId, valido: valido, apelido: apelido, nomeDe: nomeDe, link: link,
    lista: lista, lembrar: lembrar, esquecer: esquecer,
    nome: nome, salvarNome: salvarNome, cor: cor, salvarCor: salvarCor,
    desenharQR: desenharQR
  };
})(window.IlhasDeTinta);

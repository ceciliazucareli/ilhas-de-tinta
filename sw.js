/*
 * sw.js — service worker: guarda todos os arquivos do jogo no aparelho para o
 * site abrir (e o modo Offline funcionar) mesmo sem internet, depois da
 * primeira visita.
 *
 * IMPORTANTE: ao mudar qualquer arquivo do jogo, aumente VERSAO. O navegador
 * baixa o sw.js novo, guarda os arquivos novos num cache novo e apaga o antigo.
 *
 * Estratégia: "cache primeiro". O modo Online continua precisando de internet
 * (as conexões com o Supabase não passam pelo cache).
 */
var VERSAO = 'ilhas-de-tinta-v2';

var ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/config.js',
  'js/grid.js',
  'js/player.js',
  'js/input.js',
  'js/renderer.js',
  'js/ui.js',
  'js/ai.js',
  'js/setup.js',
  'js/vendor/supabase-2.119.0.umd.js',
  'js/online.js',
  'js/game.js',
  'icones/icone.svg',
  'icones/icone-192.png',
  'icones/icone-512.png'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(VERSAO)
      .then(function (cache) { return cache.addAll(ARQUIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (nome) {
        if (nome.indexOf('ilhas-de-tinta-') === 0 && nome !== VERSAO) return caches.delete(nome);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evento) {
  var pedido = evento.request;
  if (pedido.method !== 'GET') return;
  var url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return; // Supabase e outros: direto na rede

  evento.respondWith(
    caches.match(pedido, { ignoreSearch: true }).then(function (resposta) {
      if (resposta) return resposta;
      return fetch(pedido).catch(function () {
        // Sem internet e sem cache: para páginas, devolve o jogo.
        if (pedido.mode === 'navigate') return caches.match('index.html');
        throw new Error('sem internet');
      });
    })
  );
});

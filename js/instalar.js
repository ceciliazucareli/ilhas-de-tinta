/*
 * instalar.js — transformar o site em app (PWA) e mantê-lo atualizado.
 *
 * - Android / Chrome / Edge (computador): o navegador avisa que dá para instalar
 *   (evento beforeinstallprompt); aí aparece o botão "📲 Instalar o jogo" no menu.
 * - iPhone / iPad (Safari): não existe botão automático; mostramos como fazer:
 *   Compartilhar → "Adicionar à Tela de Início".
 * - Já instalado (abrindo pelo ícone): nada disso aparece.
 * - Atualização: quando sai uma versão nova (VERSAO no sw.js), o novo service
 *   worker assume e a página recarrega sozinha, mas só num momento seguro (no
 *   menu, fora de partida e fora de sala online).
 * - Atalhos do ícone (segurar o ícone no Android): ?abrir=offline / ?abrir=online.
 */
(function (IT) {
  'use strict';

  var pedidoInstalacao = null;

  function $(id) { return document.getElementById(id); }

  function jaInstalado() {
    return (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) ||
      window.navigator.standalone === true;
  }

  function ehIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad "de computador"
  }

  function atualizarMenu() {
    var botao = $('botao-instalar'), dicaIOS = $('dica-instalar-ios');
    if (!botao) return;
    var instalado = jaInstalado();
    botao.hidden = instalado || !pedidoInstalacao;
    dicaIOS.hidden = instalado || !ehIOS() || !!pedidoInstalacao;
    document.body.classList.toggle('instalado', instalado);
  }

  /* Recarrega para a versão nova só quando ninguém vai perder nada. */
  function recarregarQuandoSeguro() {
    var t = setInterval(function () {
      var jogo = IT.jogo;
      var livre = jogo && (jogo.estado === 'menu' || jogo.estado === 'configuracao') &&
        !(IT.online && IT.online.conexao());
      if (livre) { clearInterval(t); location.reload(); }
    }, 2000);
  }

  function iniciarServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var tinhaVersao = !!navigator.serviceWorker.controller; // na 1ª visita não recarrega
    var recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!tinhaVersao || recarregando) return;
      recarregando = true;
      recarregarQuandoSeguro();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      // Procura versão nova ao voltar para o app e de hora em hora.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
      setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
    }).catch(function (erro) {
      console.warn('Service worker não registrado:', erro);
    });
  }

  // Registrado já no carregamento: o navegador pode avisar antes do "load".
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();          // nós mostramos o nosso botão
    pedidoInstalacao = e;
    atualizarMenu();
  });

  IT.instalar = {
    iniciar: function () {
      window.addEventListener('appinstalled', function () {
        pedidoInstalacao = null;
        atualizarMenu();
        IT.ui.mostrarMensagem('Pronto! O jogo está na sua tela inicial. 🎉', 'sucesso');
      });
      $('botao-instalar').addEventListener('click', function () {
        if (!pedidoInstalacao) return;
        var pedido = pedidoInstalacao;
        pedidoInstalacao = null;
        pedido.prompt();
        pedido.userChoice.then(atualizarMenu, atualizarMenu);
      });
      if (window.matchMedia) {
        var mq = matchMedia('(display-mode: standalone)');
        if (mq.addEventListener) mq.addEventListener('change', atualizarMenu);
      }
      atualizarMenu();
      iniciarServiceWorker();

      // Atalhos do ícone instalado.
      var abrir = new URLSearchParams(location.search).get('abrir');
      if (abrir === 'offline') IT.jogo.irPara('configuracao');
      else if (abrir === 'online' && IT.online) IT.online.abrir();
    },
    jaInstalado: jaInstalado
  };
})(window.IlhasDeTinta);

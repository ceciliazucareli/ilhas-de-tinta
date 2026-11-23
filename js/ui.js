/*
 * ui.js — interface em HTML por cima do canvas:
 * HUD (porcentagem de cada jogador, meta e relógio), mensagens rápidas,
 * tela de configuração e tela de fim com ranking.
 */
(function (IT) {
  'use strict';

  var el = {};
  var timerMensagem = null;
  var chips = []; // elementos do placar no modo multi, um por jogador

  function $(id) { return document.getElementById(id); }

  /* Telas por cima do mapa e o botão que recebe o foco em cada uma. */
  var TELAS = {
    menu: { id: 'tela-menu', foco: 'botao-offline' },
    configuracao: { id: 'tela-configuracao', foco: 'botao-jogar' },
    online: { id: 'tela-online', foco: 'online-nome' },
    sala: { id: 'tela-sala', foco: 'sala-jogar' },
    fim: { id: 'tela-fim', foco: 'botao-jogar-de-novo' }
  };

  function porcento(fracao) { return Math.floor(fracao * 100) + '%'; }

  function formatarTempo(segundos) {
    var s = Math.ceil(segundos);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  IT.ui = {
    /* callbacks: { aoJogar, aoJogarDeNovo, aoMudarJogadores } */
    iniciar: function (callbacks) {
      el.mensagem = $('mensagem');
      el.hudSolo = $('hud-solo');
      el.hudMulti = $('hud-multi');
      el.porcentagem = $('porcentagem');
      el.barra = $('barra-preenchida');
      el.marcaMeta = $('marca-meta');
      el.textoMeta = $('texto-meta');
      el.placar = $('placar');
      el.relogio = $('relogio');
      el.metaMulti = $('meta-multi');
      el.telaConfiguracao = $('tela-configuracao');
      el.telaFim = $('tela-fim');
      el.fimTitulo = $('fim-titulo');
      el.fimTexto = $('fim-texto');
      el.fimRanking = $('fim-ranking');
      el.controlesToque = $('controles-toque');

      el.fimEspera = $('fim-espera');
      el.botaoJogarDeNovo = $('botao-jogar-de-novo');
      el.botaoMudarJogadores = $('botao-mudar-jogadores');

      $('botao-jogar').addEventListener('click', callbacks.aoJogar);
      el.botaoJogarDeNovo.addEventListener('click', callbacks.aoJogarDeNovo);
      el.botaoMudarJogadores.addEventListener('click', callbacks.aoMudarJogadores);
      $('botao-offline').addEventListener('click', callbacks.aoOffline);
      $('botao-online').addEventListener('click', callbacks.aoOnline);
      $('botao-config-voltar').addEventListener('click', callbacks.aoVoltarMenu);
    },

    /* Monta o HUD certo para o modo da partida (solo ou multi). */
    prepararPartida: function (jogo) {
      var meta = Math.round(jogo.meta * 100);
      var solo = jogo.modo === 'solo';
      el.hudSolo.hidden = !solo;
      el.hudMulti.hidden = solo;

      if (solo) {
        el.textoMeta.textContent = 'Conquiste ' + meta + '% do mapa!';
        el.marcaMeta.style.left = meta + '%';
      } else {
        el.metaMulti.textContent = 'Chegue a ' + meta + '% do mapa ou tenha mais território quando o tempo acabar!';
        el.placar.innerHTML = '';
        chips = jogo.jogadores.map(function (j) {
          var li = document.createElement('li');
          li.className = 'chip';
          li.style.setProperty('--cor', j.cor.tinta);
          li.style.setProperty('--cor-escura', j.cor.escura);
          li.innerHTML = '<span class="chip-bolinha"></span>' +
            '<span class="chip-nome"></span><strong class="chip-pct">0%</strong>';
          li.querySelector('.chip-nome').textContent = j.nome;
          el.placar.appendChild(li);
          return li;
        });
        IT.ui.atualizarRelogio(jogo.tempoRestante);
      }

      // Botões de toque só aparecem se houver algum humano jogando.
      var temHumano = jogo.jogadores.some(function (j) { return j.tipo === 'humano'; });
      el.controlesToque.hidden = !temHumano;
    },

    /* Atualiza a porcentagem de cada jogador. */
    atualizarHUD: function (jogo) {
      if (jogo.modo === 'solo') {
        var fracao = jogo.grade.fracao(1);
        el.porcentagem.textContent = porcento(fracao);
        el.barra.style.width = Math.min(100, fracao * 100) + '%';
        return;
      }
      var lider = null, maior = -1;
      jogo.jogadores.forEach(function (j, i) {
        var n = jogo.grade.contar(j.id);
        chips[i].querySelector('.chip-pct').textContent = porcento(n / jogo.grade.total);
        if (n > maior) { maior = n; lider = i; }
      });
      chips.forEach(function (chip, i) { chip.classList.toggle('lider', i === lider); });
    },

    atualizarRelogio: function (segundos) {
      el.relogio.textContent = '⏱ ' + formatarTempo(segundos);
      el.relogio.classList.toggle('acabando', segundos <= 15);
    },

    /*
     * Mostra só a tela do estado atual:
     * 'menu', 'configuracao', 'online', 'sala', 'jogando' (nenhuma) ou 'fim'.
     */
    mostrarEstado: function (estado) {
      var foco = null;
      Object.keys(TELAS).forEach(function (nome) {
        var tela = $(TELAS[nome].id);
        tela.hidden = nome !== estado;
        if (nome === estado) foco = $(TELAS[nome].foco);
      });
      if (foco && !foco.hidden && !foco.disabled) foco.focus();
      if (estado === 'jogando' && document.activeElement) document.activeElement.blur();
    },

    /* Botões da tela de fim: 'offline', 'anfitriao' ou 'cliente' (online). */
    configurarFim: function (papel) {
      var cliente = papel === 'cliente';
      el.botaoJogarDeNovo.hidden = cliente;
      el.fimEspera.hidden = !cliente;
      el.botaoMudarJogadores.textContent = papel === 'offline' ? 'Mudar jogadores'
        : papel === 'anfitriao' ? 'Voltar para a sala' : 'Sair da sala';
    },

    /* Tela de fim: comemoração no solo; ranking colorido com vários jogadores. */
    mostrarFim: function (jogo, ranking, porTempo) {
      el.fimRanking.innerHTML = '';
      if (jogo.modo === 'solo') {
        el.fimTitulo.textContent = 'Uhuu! Você pintou a ilha! 🎉';
        el.fimTexto.textContent = 'Que explorador incrível! A ilha está cheia de cor.';
        el.fimRanking.hidden = true;
      } else {
        var vencedor = ranking[0];
        var empate = ranking.length > 1 && ranking[1].celulas === vencedor.celulas;
        var humanos = jogo.jogadores.filter(function (j) { return j.tipo === 'humano'; }).length;
        if (empate) {
          el.fimTitulo.textContent = 'Empate! Que disputa! 🤝';
        } else if (vencedor.jogador.tipo === 'cpu' && humanos > 0) {
          el.fimTitulo.textContent = vencedor.jogador.nome + ' venceu desta vez! 🤖';
        } else {
          el.fimTitulo.textContent = 'Parabéns, ' + vencedor.jogador.nome + '! 🎉';
        }
        el.fimTexto.textContent = porTempo
          ? 'O tempo acabou!'
          : vencedor.jogador.nome + ' chegou na meta!';
        if (vencedor.jogador.tipo === 'cpu' && humanos > 0 && !empate) {
          el.fimTexto.textContent += ' Tente de novo, você consegue! 💪';
        }
        var medalhas = ['🥇', '🥈', '🥉', '🏅'];
        ranking.forEach(function (r, i) {
          var li = document.createElement('li');
          li.style.setProperty('--cor', r.jogador.cor.tinta);
          li.style.setProperty('--cor-escura', r.jogador.cor.escura);
          li.innerHTML = '<span class="medalha"></span><span class="chip-bolinha"></span>' +
            '<span class="ranking-nome"></span><strong></strong>';
          li.querySelector('.medalha').textContent = medalhas[i];
          li.querySelector('.ranking-nome').textContent = r.jogador.nome;
          li.querySelector('strong').textContent = porcento(r.fracao);
          el.fimRanking.appendChild(li);
        });
        el.fimRanking.hidden = false;
      }
      IT.ui.mostrarEstado('fim');
    },

    /* Mostra um balão de mensagem por alguns segundos (cor opcional do texto). */
    mostrarMensagem: function (texto, tipo, cor) {
      el.mensagem.textContent = texto;
      el.mensagem.className = 'mensagem visivel ' + (tipo || '');
      el.mensagem.style.color = cor || '';
      clearTimeout(timerMensagem);
      timerMensagem = setTimeout(function () {
        el.mensagem.className = 'mensagem';
      }, 1600);
    },

    esconderMensagem: function () {
      clearTimeout(timerMensagem);
      el.mensagem.className = 'mensagem';
    }
  };
})(window.IlhasDeTinta);

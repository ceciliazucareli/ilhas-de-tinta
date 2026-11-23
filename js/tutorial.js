/*
 * tutorial.js — primeira partida guiada (uns 20 segundos).
 *
 * Aparece sozinha na primeira vez que alguém aperta "Jogar" no modo offline
 * (fica salvo no aparelho) e pode ser vista de novo pelo botão "❓ Como jogar"
 * do menu. Cada passo só avança quando a criança FAZ a ação:
 *
 *   1. sair    "Deslize para cima para sair de casa"   → saiu do território
 *   2. virar   "Agora vire para o lado"                 → virou fora de casa
 *   3. voltar  "Volte para casa!" (casa piscando)       → conquistou a primeira área
 *   4. pronto  "Muito bem! Só não pise no seu rastro"   → botão "Vamos jogar!"
 *
 * Se pisar no próprio rastro no meio do caminho, recomeça do passo 1 com uma
 * mensagem de incentivo. "Pular" encerra a qualquer momento.
 */
(function (IT) {
  'use strict';

  var CHAVE = 'ilhas-de-tinta:tutorial-feito';
  var passo = null;     // 'sair' | 'virar' | 'voltar' | 'pronto' | null
  var depois = null;    // configuração da partida que começa ao terminar (ou null = menu)
  var el = {};
  var penalidadesVistas = 0;
  var toque = false;

  function $(id) { return document.getElementById(id); }

  function textos() {
    return {
      sair: toque
        ? ['Este é você! 👋', 'Deslize o dedo para <b>cima</b> para sair de casa.']
        : ['Este é você! 👋', 'Aperte <b>↑</b> (ou <b>W</b>) para sair de casa.'],
      virar: toque
        ? ['Isso! Agora vire 🔄', 'Deslize para o <b>lado</b> (direita ou esquerda).']
        : ['Isso! Agora vire 🔄', 'Aperte <b>←</b> ou <b>→</b> para virar.'],
      voltar: ['Agora volte para casa! 🏠', 'Tudo o que ficar <b>dentro do caminho</b> vira seu.'],
      pronto: ['Muito bem! 🎉', 'Você pintou a ilha! Só <b>não pise no seu próprio rastro</b>.']
    };
  }

  function mostrar(nome) {
    passo = nome;
    var t = textos()[nome];
    el.titulo.textContent = t[0];
    el.texto.innerHTML = t[1];
    el.botaoJogar.hidden = nome !== 'pronto';
    el.botaoPular.hidden = nome === 'pronto';
    el.passos.textContent = nome === 'pronto' ? '' : 'Passo ' + (['sair', 'virar', 'voltar'].indexOf(nome) + 1) + ' de 3';
    el.caixa.hidden = false;
    el.caixa.classList.remove('pulo');
    void el.caixa.offsetWidth; // reinicia a animação
    el.caixa.classList.add('pulo');
    if (IT.renderer.destacarCasa) IT.renderer.destacarCasa(nome === 'voltar' ? 1 : 0);
  }

  function marcarFeito() {
    try { localStorage.setItem(CHAVE, '1'); } catch (e) { /* sem armazenamento */ }
  }

  function terminar() {
    marcarFeito();
    passo = null;
    el.caixa.hidden = true;
    if (IT.renderer.destacarCasa) IT.renderer.destacarCasa(0);
    var proxima = depois;
    depois = null;
    if (proxima) IT.jogo.jogar(proxima);
    else IT.jogo.irPara('menu');
  }

  IT.tutorial = {
    iniciar: function () {
      el.caixa = $('tutorial');
      el.titulo = $('tutorial-titulo');
      el.texto = $('tutorial-texto');
      el.passos = $('tutorial-passos');
      el.botaoPular = $('tutorial-pular');
      el.botaoJogar = $('tutorial-jogar');
      el.botaoPular.addEventListener('click', terminar);
      el.botaoJogar.addEventListener('click', terminar);
      $('botao-como-jogar').addEventListener('click', function () { IT.tutorial.comecar(null); });
    },

    /* Primeira vez neste aparelho? */
    precisa: function () {
      try { return !localStorage.getItem(CHAVE); } catch (e) { return false; }
    },

    ativo: function () { return passo !== null; },

    /* Começa a partida guiada; "proxima" é a partida que vem depois (ou null). */
    comecar: function (proxima) {
      depois = proxima || null;
      toque = document.body.classList.contains('toque');
      penalidadesVistas = 0;
      IT.jogo.jogar({ vagas: [{ tipo: 'humano', cor: 'rosa', nome: 'Você', dificuldade: 'medio' }] }, { tutorial: true });
      mostrar('sair');
    },

    /* Chamado a cada quadro pelo game.js: confere se o passo foi cumprido. */
    atualizar: function (jogo) {
      if (!passo || jogo.estado !== 'jogando' || jogo.pausado) return;
      var j = jogo.jogadores[0], e = j.explorador, g = jogo.grade;
      if (j.estatisticas.proprioRastro > penalidadesVistas) {
        penalidadesVistas = j.estatisticas.proprioRastro;
        if (passo !== 'pronto') {
          mostrar('sair');
          el.titulo.textContent = 'Tudo bem, tente de novo! 🙂';
          return;
        }
      }
      var fora = g.temRastro(j.id);
      if (passo === 'sair' && fora) mostrar('virar');
      else if (passo === 'virar' && fora && (e.direcao === 'esquerda' || e.direcao === 'direita')) mostrar('voltar');
      else if (passo === 'voltar' && j.estatisticas.capturas > 0) {
        mostrar('pronto');
        IT.som.tocar('vitoria');
      } else if (passo === 'virar' && !fora && g.contar(j.id) > 9) {
        mostrar('pronto'); // voltou para casa virando de outro jeito: também vale
      }
    },

    /* Saiu da partida guiada pelo menu de pausa. */
    cancelar: function () {
      passo = null;
      depois = null;
      if (el.caixa) el.caixa.hidden = true;
      if (IT.renderer.destacarCasa) IT.renderer.destacarCasa(0);
    }
  };
})(window.IlhasDeTinta);

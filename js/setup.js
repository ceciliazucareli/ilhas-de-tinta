/*
 * setup.js — tela de configuração antes de jogar.
 * Escolhe quantos jogadores (1 a 4) e, para cada vaga: Humano ou CPU, cor
 * (sem repetir), nome e, para a CPU, a dificuldade. Mostra os controles de
 * cada humano. Com 1 jogador é o modo solo de sempre.
 */
(function (IT) {
  'use strict';

  var quantidade = 1;
  var vagas = [
    { tipo: 'humano', cor: 'rosa',    dificuldade: 'medio', nome: '', nomeEditado: false },
    { tipo: 'cpu',    cor: 'azul',    dificuldade: 'medio', nome: '', nomeEditado: false },
    { tipo: 'cpu',    cor: 'amarelo', dificuldade: 'facil', nome: '', nomeEditado: false },
    { tipo: 'cpu',    cor: 'roxo',    dificuldade: 'dificil', nome: '', nomeEditado: false }
  ];

  var el = {};

  function tipoEfetivo(i) { return quantidade === 1 ? 'humano' : vagas[i].tipo; }

  /* Nome padrão: "Jogador 2" ou "CPU Médio" (com número se houver repetido). */
  function nomePadrao(i) {
    if (tipoEfetivo(i) === 'humano') return 'Jogador ' + (i + 1);
    var base = 'CPU ' + IT.DIFICULDADES[vagas[i].dificuldade].nome;
    var repetidos = 0, antes = 0;
    for (var k = 0; k < quantidade; k++) {
      if (tipoEfetivo(k) === 'cpu' && vagas[k].dificuldade === vagas[i].dificuldade && !vagas[k].nomeEditado) {
        repetidos++;
        if (k < i) antes++;
      }
    }
    return repetidos > 1 ? base + ' ' + (antes + 1) : base;
  }

  function nomeDe(i) {
    var nome = vagas[i].nomeEditado ? vagas[i].nome.trim() : '';
    return nome || nomePadrao(i);
  }

  /* Texto dos controles de um humano (com um único humano, ele usa vários). */
  function textoControles(i) {
    var humanos = 0;
    for (var k = 0; k < quantidade; k++) if (tipoEfetivo(k) === 'humano') humanos++;
    var proprio = IT.CONTROLES[i].rotulo;
    if (humanos === 1) {
      var extras = ['W A S D', 'Setas'];
      if (extras.indexOf(proprio) === -1 && i > 1) extras.push(proprio);
      return '🎮 ' + extras.join(', ') + ' ou botões na tela';
    }
    return '🎮 ' + proprio + (i === primeiroHumano() ? ' (ou botões na tela)' : '');
  }

  function primeiroHumano() {
    for (var k = 0; k < quantidade; k++) if (tipoEfetivo(k) === 'humano') return k;
    return -1;
  }

  /* Troca a cor; se outra vaga já usa essa cor, as duas trocam entre si. */
  function escolherCor(i, cor) {
    for (var k = 0; k < vagas.length; k++) {
      if (k !== i && vagas[k].cor === cor) vagas[k].cor = vagas[i].cor;
    }
    vagas[i].cor = cor;
  }

  function botao(texto, classe, ativo, foco, aoClicar) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.textContent = texto;
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    b.dataset.foco = foco;
    b.addEventListener('click', aoClicar);
    return b;
  }

  function linha(rotulo) {
    var div = document.createElement('div');
    div.className = 'vaga-linha';
    var span = document.createElement('span');
    span.className = 'vaga-rotulo';
    span.textContent = rotulo;
    div.appendChild(span);
    return div;
  }

  /* Redesenha a tela, devolvendo o foco ao controle que estava focado. */
  function desenhar() {
    var focado = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.foco : null;

    // Botões 1, 2, 3, 4.
    el.quantidade.innerHTML = '';
    for (var n = 1; n <= IT.config.MAX_JOGADORES; n++) {
      (function (n) {
        var b = botao(String(n), 'opcao', n === quantidade, 'qtd' + n, function () {
          quantidade = n;
          desenhar();
        });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', n === quantidade ? 'true' : 'false');
        b.setAttribute('aria-label', n === 1 ? '1 jogador' : n + ' jogadores');
        el.quantidade.appendChild(b);
      })(n);
    }

    el.vagas.innerHTML = '';
    for (var i = 0; i < quantidade; i++) {
      (function (i) {
        var vaga = vagas[i];
        var cores = IT.CORES_JOGADORES[vaga.cor];
        var li = document.createElement('li');
        li.className = 'vaga';
        li.style.setProperty('--cor', cores.tinta);
        li.style.setProperty('--cor-escura', cores.escura);

        // Número da vaga + nome.
        var topo = document.createElement('div');
        topo.className = 'vaga-topo';
        var numero = document.createElement('span');
        numero.className = 'vaga-numero';
        numero.textContent = 'J' + (i + 1);
        var nome = document.createElement('input');
        nome.className = 'vaga-nome';
        nome.maxLength = 12;
        nome.value = nomeDe(i);
        nome.setAttribute('aria-label', 'Nome do jogador ' + (i + 1));
        nome.dataset.foco = 'nome' + i;
        nome.addEventListener('input', function () {
          vaga.nome = nome.value;
          vaga.nomeEditado = nome.value.trim() !== '';
        });
        nome.addEventListener('change', desenhar);
        topo.appendChild(numero);
        topo.appendChild(nome);
        li.appendChild(topo);

        // Humano ou CPU (no solo é sempre humano).
        if (quantidade > 1) {
          var quem = linha('Quem joga');
          ['humano', 'cpu'].forEach(function (tipo) {
            quem.appendChild(botao(tipo === 'humano' ? '🧒 Humano' : '🤖 CPU', 'opcao', vaga.tipo === tipo,
              'tipo' + i + tipo, function () { vaga.tipo = tipo; desenhar(); }));
          });
          li.appendChild(quem);
        }

        // Cor.
        var linhaCor = linha('Cor');
        IT.ORDEM_CORES.forEach(function (cor) {
          var b = botao('', 'cor-opcao', vaga.cor === cor, 'cor' + i + cor, function () {
            escolherCor(i, cor);
            desenhar();
          });
          b.style.background = IT.CORES_JOGADORES[cor].tinta;
          b.setAttribute('aria-label', 'Cor ' + IT.CORES_JOGADORES[cor].nome);
          b.title = IT.CORES_JOGADORES[cor].nome;
          linhaCor.appendChild(b);
        });
        li.appendChild(linhaCor);

        // Controles (humano) ou dificuldade (CPU).
        if (tipoEfetivo(i) === 'humano') {
          var controles = linha('Controles');
          var texto = document.createElement('span');
          texto.className = 'vaga-controles';
          texto.textContent = textoControles(i);
          controles.appendChild(texto);
          li.appendChild(controles);
        } else {
          var nivel = linha('Nível');
          Object.keys(IT.DIFICULDADES).forEach(function (chave) {
            nivel.appendChild(botao(IT.DIFICULDADES[chave].nome, 'opcao', vaga.dificuldade === chave,
              'nivel' + i + chave, function () { vaga.dificuldade = chave; desenhar(); }));
          });
          li.appendChild(nivel);
        }

        el.vagas.appendChild(li);
      })(i);
    }

    if (focado) {
      var alvo = document.querySelector('[data-foco="' + focado + '"]');
      if (alvo) alvo.focus();
    }
  }

  IT.setup = {
    iniciar: function () {
      el.quantidade = document.getElementById('setup-quantidade');
      el.vagas = document.getElementById('setup-vagas');
      desenhar();
    },

    /* Configuração escolhida, no formato que o game.js usa. */
    configuracao: function () {
      var lista = [];
      for (var i = 0; i < quantidade; i++) {
        lista.push({
          tipo: tipoEfetivo(i),
          cor: vagas[i].cor,
          nome: nomeDe(i),
          dificuldade: vagas[i].dificuldade
        });
      }
      return { vagas: lista };
    },

    /* Usado nos testes: escolhe a quantidade e altera vagas. */
    definir: function (n, alteracoes) {
      quantidade = n;
      (alteracoes || []).forEach(function (a, i) {
        if (a) Object.keys(a).forEach(function (k) { vagas[i][k] = a[k]; });
      });
      desenhar();
    }
  };
})(window.IlhasDeTinta);

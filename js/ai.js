/*
 * ai.js — o "cérebro" dos jogadores CPU.
 *
 * Ideia geral: a CPU faz excursões em forma de retângulo. Saindo de casa, ela
 * escolhe um plano (pontos de passagem: sair, andar de lado, voltar) e, quando
 * termina o plano — ou quando acha perigoso continuar — volta para o próprio
 * território pelo caminho mais curto (busca em largura, BFS).
 *
 * Segurança (Médio e Difícil): a cada passo, só são aceitas direções que
 * (1) não pisam no próprio rastro e (2) ainda têm um caminho de volta para casa
 * sem cruzar o próprio rastro. Assim ela nunca se prende nem pisa no próprio
 * rastro por descuido. (Ela ainda pode ter o rastro cortado por outro jogador.)
 *
 * Níveis:
 *   Fácil   — mais lenta, voltas pequenas, às vezes muda de direção ao acaso.
 *   Médio   — voltas médias; volta para casa se o rastro ficar longo ou se um
 *             adversário chegar perto.
 *   Difícil — compara várias voltas e escolhe a maior e mais segura; persegue
 *             rastros de adversários que estejam perto. É um pouco mais lenta
 *             que um humano e espera um tempo entre uma caçada e outra, para
 *             continuar possível de vencer.
 */
(function (IT) {
  'use strict';

  var NIVEIS = {
    facil: {
      profundidade: [2, 3], lado: [2, 4], candidatos: 1,
      acaso: 0.2,          // chance de virar ao acaso em cada célula
      seguro: false,       // não confere o caminho de volta nas viradas ao acaso
      rastroMax: 12, medo: 0, caca: 0
    },
    medio: {
      profundidade: [3, 4], lado: [3, 5], candidatos: 1,
      acaso: 0, seguro: true,
      rastroMax: 16,       // rastro maior que isso: volta para casa
      medo: 4,             // adversário a esta distância: volta para casa
      caca: 0
    },
    dificil: {
      profundidade: [3, 5], lado: [3, 6], candidatos: 5,
      acaso: 0, seguro: true,
      rastroMax: 24, medo: 3,
      caca: 7,             // persegue rastros de adversários até esta distância
      esperaCaca: 6        // segundos de descanso entre caçadas
    }
  };

  var NOMES_DIRECOES = ['cima', 'baixo', 'esquerda', 'direita'];
  var PERPENDICULARES = {
    cima: ['esquerda', 'direita'], baixo: ['esquerda', 'direita'],
    esquerda: ['cima', 'baixo'], direita: ['cima', 'baixo']
  };

  function sortear(intervalo) {
    return intervalo[0] + Math.floor(Math.random() * (intervalo[1] - intervalo[0] + 1));
  }

  function limitar(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function Cerebro(jogador, jogo) {
    this.jogador = jogador;
    this.jogo = jogo;
    this.nivel = NIVEIS[jogador.dificuldade] || NIVEIS.medio;
    this.plano = [];         // pontos de passagem {x, y}
    this.modo = 'casa';      // 'casa' | 'sair' | 'voltar' | 'cacar'
    this.descansoCaca = 0;   // momento (s) a partir do qual pode caçar de novo
  }

  /* Chamado após uma penalidade ou renascimento: esquece o plano. */
  Cerebro.prototype.reiniciar = function () {
    this.plano = [];
    this.modo = 'casa';
  };

  /* ---------- Funções de apoio ---------- */

  Cerebro.prototype.ehMeu = function (x, y) {
    return this.jogo.grade.dono(x, y) === this.jogador.id;
  };

  Cerebro.prototype.ehMeuRastro = function (x, y) {
    return this.jogo.grade.rastro(x, y) === this.jogador.id;
  };

  /* Distância (em passos) de (x, y) até uma célula que satisfaça "objetivo",
     sem pisar no próprio rastro. Infinity se não houver caminho. */
  Cerebro.prototype.distancia = function (x, y, objetivo) {
    if (objetivo(x, y)) return 0;
    var self = this;
    var caminho = this.jogo.grade.buscarCaminho(x, y, objetivo,
      function (a, b) { return self.ehMeuRastro(a, b); });
    return caminho ? caminho.length : Infinity;
  };

  Cerebro.prototype.distanciaDeCasa = function (x, y) {
    var self = this;
    return this.distancia(x, y, function (a, b) { return self.ehMeu(a, b); });
  };

  /* Menor distância (Manhattan) até o explorador de um adversário. */
  Cerebro.prototype.adversarioMaisPerto = function (x, y) {
    var menor = Infinity, eu = this.jogador;
    this.jogo.jogadores.forEach(function (j) {
      if (j === eu) return;
      var d = Math.abs(j.explorador.x - x) + Math.abs(j.explorador.y - y);
      if (d < menor) menor = d;
    });
    return menor;
  };

  /* Direções possíveis agora: dentro do mapa e sem meia-volta. */
  Cerebro.prototype.direcoesPossiveis = function () {
    var e = this.jogador.explorador, grade = this.jogo.grade;
    var proibida = e.direcaoProibida();
    return NOMES_DIRECOES.filter(function (nome) {
      var d = IT.DIRECOES[nome];
      return nome !== proibida && grade.dentro(e.x + d.x, e.y + d.y);
    }).map(function (nome) {
      var d = IT.DIRECOES[nome];
      return { nome: nome, x: e.x + d.x, y: e.y + d.y };
    });
  };

  /* ---------- Planejamento ---------- */

  /*
   * Monta um plano de excursão retangular saindo na direção "d1":
   * anda dentro de casa até a borda do território, sai "profundidade" células,
   * anda "lado" células para o lado e volta em paralelo. Devolve null se não
   * der para sair por ali.
   */
  Cerebro.prototype.montarPlano = function (d1) {
    var e = this.jogador.explorador, grade = this.jogo.grade, n = this.nivel;
    var v1 = IT.DIRECOES[d1];
    var x = e.x, y = e.y;
    while (grade.dentro(x, y) && this.ehMeu(x, y)) { x += v1.x; y += v1.y; }
    if (!grade.dentro(x, y)) return null; // território encosta na borda nessa direção

    var prof = sortear(n.profundidade), lado = sortear(n.lado);
    var d2 = PERPENDICULARES[d1][Math.random() < 0.5 ? 0 : 1];
    var v2 = IT.DIRECOES[d2];
    var maxX = grade.colunas - 1, maxY = grade.linhas - 1;

    var p1 = { x: limitar(x + v1.x * (prof - 1), 0, maxX), y: limitar(y + v1.y * (prof - 1), 0, maxY) };
    var p2 = { x: limitar(p1.x + v2.x * lado, 0, maxX), y: limitar(p1.y + v2.y * lado, 0, maxY) };
    var p3 = { x: limitar(p2.x - v1.x * (prof - 1), 0, maxX), y: limitar(p2.y - v1.y * (prof - 1), 0, maxY) };
    if (p1.x === p2.x && p1.y === p2.y) return null; // encostado na borda: sem espaço de lado

    return { pontos: [p1, p2, p3], canto: { x: x, y: y }, oposto: p2 };
  };

  /* Nota de um plano: área nova que ele cerca, menos o perigo de adversários perto. */
  Cerebro.prototype.notaDoPlano = function (plano) {
    var grade = this.jogo.grade, id = this.jogador.id;
    var x0 = Math.min(plano.canto.x, plano.oposto.x), x1 = Math.max(plano.canto.x, plano.oposto.x);
    var y0 = Math.min(plano.canto.y, plano.oposto.y), y1 = Math.max(plano.canto.y, plano.oposto.y);
    var ganho = 0;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dono = grade.dono(x, y);
        if (dono === 0) ganho += 1;
        else if (dono !== id) ganho += 1.5; // tomar território de adversário vale mais
      }
    }
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var perigo = this.adversarioMaisPerto(Math.round(cx), Math.round(cy));
    var raio = (x1 - x0 + y1 - y0) / 2 + 3;
    if (perigo < raio) ganho *= 0.4; // adversário perto da área: arriscado
    return ganho;
  };

  Cerebro.prototype.criarPlano = function () {
    var melhor = null, melhorNota = -Infinity;
    var tentativas = Math.max(this.nivel.candidatos, 4);
    for (var i = 0; i < tentativas; i++) {
      var plano = this.montarPlano(NOMES_DIRECOES[Math.floor(Math.random() * 4)]);
      if (!plano) continue;
      if (this.nivel.candidatos === 1) { melhor = plano; break; }
      var nota = this.notaDoPlano(plano);
      if (nota > melhorNota) { melhorNota = nota; melhor = plano; }
    }
    this.plano = melhor ? melhor.pontos : [];
    this.modo = melhor ? 'sair' : 'casa';
  };

  /* Difícil: procura o rastro de um adversário perto para cortar. */
  Cerebro.prototype.procurarCaca = function () {
    var n = this.nivel, e = this.jogador.explorador, grade = this.jogo.grade;
    if (!n.caca || this.jogo.ultimoTempo < this.descansoCaca) return null;
    if (grade.tamanhoRastro(this.jogador.id) > 8) return null;
    var id = this.jogador.id, self = this;
    var caminho = grade.buscarCaminho(e.x, e.y,
      function (x, y) {
        var r = grade.rastro(x, y);
        return r !== 0 && r !== id;
      },
      function (x, y) { return self.ehMeuRastro(x, y); });
    if (!caminho || caminho.length > n.caca) return null;
    return caminho[caminho.length - 1];
  };

  /* ---------- Decisão a cada célula ---------- */

  Cerebro.prototype.decidir = function () {
    var e = this.jogador.explorador, grade = this.jogo.grade, n = this.nivel;
    var self = this;
    var emCasa = this.ehMeu(e.x, e.y);
    var rastro = grade.tamanhoRastro(this.jogador.id);

    // Em casa e sem rastro: hora de planejar uma nova volta.
    if (emCasa && rastro === 0 && (this.modo === 'casa' || this.modo === 'voltar' || this.plano.length === 0)) {
      this.criarPlano();
    }

    // Tira do plano os pontos já alcançados.
    while (this.plano.length && this.plano[0].x === e.x && this.plano[0].y === e.y) this.plano.shift();

    if (rastro > 0 && this.modo !== 'voltar') {
      if (rastro >= n.rastroMax) this.modo = 'voltar';
      else if (n.medo && this.adversarioMaisPerto(e.x, e.y) <= n.medo) this.modo = 'voltar';
      else if (this.plano.length === 0 && this.modo !== 'cacar') this.modo = 'voltar';
    }

    // Difícil: caça rastros de adversários que estejam perto.
    if (this.modo !== 'voltar') {
      var caca = this.procurarCaca();
      if (caca) {
        if (this.modo !== 'cacar') this.descansoCaca = this.jogo.ultimoTempo + n.esperaCaca;
        this.modo = 'cacar';
        this.plano = [caca];
      } else if (this.modo === 'cacar') {
        this.modo = rastro > 0 ? 'voltar' : 'casa';
        this.plano = [];
      }
    }

    var opcoes = this.direcoesPossiveis();
    if (!opcoes.length) return;

    // Nunca pisar no próprio rastro de propósito.
    var semRastro = opcoes.filter(function (o) { return !self.ehMeuRastro(o.x, o.y); });

    // Fácil: às vezes vira ao acaso (sem conferir o caminho de volta).
    if (!n.seguro && rastro > 0 && Math.random() < n.acaso && semRastro.length) {
      e.pedirDirecao(semRastro[Math.floor(Math.random() * semRastro.length)].nome);
      return;
    }

    // Médio/Difícil (e o Fácil fora das viradas ao acaso): só direções com volta garantida.
    var seguras = semRastro.filter(function (o) {
      return self.ehMeu(o.x, o.y) || self.distanciaDeCasa(o.x, o.y) < Infinity;
    });
    var lista = seguras.length ? seguras : (semRastro.length ? semRastro : opcoes);

    // Para onde ir: próximo ponto do plano, ou casa.
    var alvo = this.modo === 'voltar' || !this.plano.length ? null : this.plano[0];
    var melhor = null, melhorDist = Infinity;
    lista.forEach(function (o) {
      var d = alvo
        ? self.distancia(o.x, o.y, function (x, y) { return x === alvo.x && y === alvo.y; })
        : self.distanciaDeCasa(o.x, o.y);
      d += Math.random() * 0.5; // desempate sem ficar sempre igual
      if (d < melhorDist) { melhorDist = d; melhor = o; }
    });

    if (!melhor || melhorDist === Infinity) {
      // Ponto do plano inalcançável: desiste e volta para casa.
      if (alvo) { this.plano = []; this.modo = rastro > 0 ? 'voltar' : 'casa'; }
      melhor = melhor || lista[0];
    }
    e.pedirDirecao(melhor.nome);
  };

  IT.ia = {
    criar: function (jogador, jogo) { return new Cerebro(jogador, jogo); },
    NIVEIS: NIVEIS
  };
})(window.IlhasDeTinta);

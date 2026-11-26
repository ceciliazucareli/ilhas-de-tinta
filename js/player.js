/*
 * player.js — o explorador (um por jogador).
 * Ele anda de célula em célula. Entre duas células a posição é interpolada
 * (campo "progresso" de 0 a 1) para o movimento ficar suave na tela.
 */
(function (IT) {
  'use strict';

  function Explorador(x, y) {
    this.x = x;            // célula atual (ou de onde está saindo)
    this.y = y;
    this.alvoX = x;        // célula para onde está indo
    this.alvoY = y;
    this.progresso = 0;    // 0 = em (x,y); 1 = chegou em (alvoX, alvoY)
    this.direcao = null;   // direção atual do movimento (null = parado)
    this.ultimaDirecao = 'baixo'; // para onde está olhando
    this.proximaDirecao = null;   // pedida pelo teclado/toque/CPU
    this.filaDirecao = null;      // virada seguinte, já pedida (ex.: "cima" e logo "esquerda")
    this.velocidade = 1;   // multiplicador da velocidade base (CPU fácil é mais lenta)
    // Quando há rastro, a meia-volta fica travada mesmo parado na borda,
    // para o explorador não pisar sem querer no próprio rastro.
    this.travarMeiaVolta = false;
    // Para a CPU: objeto com decidir(), chamado sempre que o explorador
    // chega numa célula (ou está parado) para escolher a próxima direção.
    this.controlador = null;
  }

  /*
   * Guarda a direção pedida; ela é aplicada ao chegar na próxima célula.
   * Meia-volta (180°) é recusada. Se a pessoa pedir duas viradas rápidas
   * (andando para a direita: "cima" e logo "esquerda"), a segunda espera na
   * fila e acontece na célula seguinte. Devolve false se o pedido foi recusado.
   */
  Explorador.prototype.pedirDirecao = function (nome) {
    if (nome === this.direcaoProibida()) {
      var pendente = this.proximaDirecao;
      if (pendente && pendente !== nome && IT.OPOSTA[pendente] !== nome) {
        this.filaDirecao = nome;
        return true;
      }
      return false;
    }
    this.proximaDirecao = nome;
    this.filaDirecao = null;
    return true;
  };

  Explorador.prototype.andando = function () {
    return this.direcao !== null;
  };

  /* Direção que não pode ser escolhida agora (meia-volta), ou null. */
  Explorador.prototype.direcaoProibida = function () {
    var referencia = this.direcao || (this.travarMeiaVolta ? this.ultimaDirecao : null);
    return referencia ? IT.OPOSTA[referencia] : null;
  };

  /* Posição "visual" em células (com fração), usada pelo renderer. */
  Explorador.prototype.posicaoVisual = function () {
    return {
      x: this.x + (this.alvoX - this.x) * this.progresso + (this.ajusteX || 0),
      y: this.y + (this.alvoY - this.y) * this.progresso + (this.ajusteY || 0)
    };
  };

  /*
   * Online (issue #7): quando a posição prevista aqui diverge da do anfitrião,
   * o explorador vai para a posição certa, mas o desenho "desliza" até lá em
   * vez de pular (o ajuste some em ~150 ms).
   */
  Explorador.prototype.corrigirSuave = function (deX, deY) {
    var agora = this.posicaoVisual();
    this.ajusteX = (this.ajusteX || 0) + (deX - agora.x);
    this.ajusteY = (this.ajusteY || 0) + (deY - agora.y);
  };

  Explorador.prototype.suavizar = function (dt) {
    if (!this.ajusteX && !this.ajusteY) return;
    var k = Math.exp(-dt * 20);
    this.ajusteX *= k; this.ajusteY *= k;
    if (Math.abs(this.ajusteX) < 0.01) this.ajusteX = 0;
    if (Math.abs(this.ajusteY) < 0.01) this.ajusteY = 0;
  };

  /* Teleporta para uma célula e fica parado. */
  Explorador.prototype.teleportar = function (x, y) {
    this.saltos = (this.saltos || 0) + 1; // online: o cliente percebe "Ops!"/renascer e corrige na hora
    this.x = this.alvoX = x;
    this.y = this.alvoY = y;
    this.progresso = 0;
    this.direcao = null;
    this.proximaDirecao = null;
    this.filaDirecao = null;
    this.travarMeiaVolta = false;
  };

  /*
   * Escolhe a próxima célula a partir da posição atual.
   * Regras: não pode dar meia-volta (180°); a borda do mapa bloqueia e faz o
   * explorador parar.
   */
  Explorador.prototype.escolherProximoPasso = function (grade) {
    var pedida = this.proximaDirecao;
    if (pedida && pedida === this.direcaoProibida()) pedida = null;
    if (pedida) {
      this.direcao = pedida;
      this.ultimaDirecao = pedida;
      this.proximaDirecao = this.filaDirecao; // a próxima virada da fila, se houver
    } else {
      this.proximaDirecao = null;
    }
    this.filaDirecao = null;
    if (!this.direcao) return;

    var d = IT.DIRECOES[this.direcao];
    var nx = this.x + d.x, ny = this.y + d.y;
    if (!grade.dentro(nx, ny)) {
      this.direcao = null; // bateu na borda: para
      return;
    }
    this.alvoX = nx;
    this.alvoY = ny;
  };

  /*
   * Avança o movimento por "dt" segundos. Sempre que chega numa célula
   * chama aoChegar(x, y), que é quem aplica as regras do jogo.
   */
  Explorador.prototype.atualizar = function (dt, grade, aoChegar) {
    if (!this.direcao) {
      // Parado: começa a andar assim que houver uma direção pedida.
      if (this.controlador) this.controlador.decidir();
      if (this.proximaDirecao) this.escolherProximoPasso(grade);
      if (!this.direcao) return;
    }
    this.progresso += dt * IT.config.VELOCIDADE * this.velocidade;
    while (this.progresso >= 1 && this.direcao) {
      this.progresso -= 1;
      // Online (cliente): guarda as últimas células de onde saiu, para conferir a
      // previsão com o anfitrião (online.js, anfitriaoNoMeuCaminho).
      if (this.caminho) { this.caminho.push(this.x, this.y); if (this.caminho.length > 60) this.caminho.splice(0, 2); }
      this.x = this.alvoX;
      this.y = this.alvoY;
      var continuar = aoChegar ? aoChegar(this.x, this.y) : true;
      if (continuar === false) { this.progresso = 0; return; }
      if (this.controlador) this.controlador.decidir();
      this.escolherProximoPasso(grade);
      if (!this.direcao) this.progresso = 0;
    }
  };

  IT.Explorador = Explorador;
})(window.IlhasDeTinta);

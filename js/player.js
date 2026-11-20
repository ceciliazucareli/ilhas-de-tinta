/*
 * player.js — o explorador.
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
    this.proximaDirecao = null;   // pedida pelo teclado/toque
    // Quando há rastro, a meia-volta fica travada mesmo parado na borda,
    // para o explorador não pisar sem querer no próprio rastro.
    this.travarMeiaVolta = false;
  }

  /* Guarda a direção pedida; ela é aplicada ao chegar na próxima célula. */
  Explorador.prototype.pedirDirecao = function (nome) {
    this.proximaDirecao = nome;
  };

  Explorador.prototype.andando = function () {
    return this.direcao !== null;
  };

  /* Posição "visual" em células (com fração), usada pelo renderer. */
  Explorador.prototype.posicaoVisual = function () {
    return {
      x: this.x + (this.alvoX - this.x) * this.progresso,
      y: this.y + (this.alvoY - this.y) * this.progresso
    };
  };

  /* Teleporta para uma célula e fica parado. */
  Explorador.prototype.teleportar = function (x, y) {
    this.x = this.alvoX = x;
    this.y = this.alvoY = y;
    this.progresso = 0;
    this.direcao = null;
    this.proximaDirecao = null;
  };

  /*
   * Escolhe a próxima célula a partir da posição atual.
   * Regras: não pode dar meia-volta (180°) enquanto anda; a borda do mapa
   * bloqueia e faz o explorador parar.
   */
  Explorador.prototype.escolherProximoPasso = function (grade) {
    var pedida = this.proximaDirecao;
    var referencia = this.direcao || (this.travarMeiaVolta ? this.ultimaDirecao : null);
    if (pedida && referencia && IT.OPOSTA[pedida] === referencia) {
      pedida = null; // meia-volta não é permitida
    }
    if (pedida) {
      this.direcao = pedida;
      this.ultimaDirecao = pedida;
    }
    this.proximaDirecao = null;
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
      if (this.proximaDirecao) this.escolherProximoPasso(grade);
      if (!this.direcao) return;
    }
    this.progresso += dt * IT.config.VELOCIDADE;
    while (this.progresso >= 1 && this.direcao) {
      this.progresso -= 1;
      this.x = this.alvoX;
      this.y = this.alvoY;
      var continuar = aoChegar ? aoChegar(this.x, this.y) : true;
      if (continuar === false) { this.progresso = 0; return; }
      this.escolherProximoPasso(grade);
      if (!this.direcao) this.progresso = 0;
    }
  };

  IT.Explorador = Explorador;
})(window.IlhasDeTinta);

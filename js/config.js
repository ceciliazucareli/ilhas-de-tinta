/*
 * config.js — constantes do jogo.
 * Todo o jogo vive no namespace global "IlhasDeTinta" (abreviado como IT
 * dentro de cada arquivo) para funcionar com <script> clássicos em file://.
 */
window.IlhasDeTinta = window.IlhasDeTinta || {};

(function (IT) {
  'use strict';

  IT.config = {
    CELULA: 28,           // tamanho de referência da célula (modo solo), em pixels
    MARGEM: 18,           // espaço em volta da ilha dentro do canvas
    VELOCIDADE: 7,        // células por segundo
    TERRITORIO_INICIAL: 3, // lado do quadrado inicial (3x3)
    META: 0.8,            // fração do mapa para vencer no modo solo (80%)

    /* ---- Modo com 2 a 4 jogadores ---- */
    // Tamanho do mapa conforme o número de jogadores (mais gente, mapa maior;
    // a célula encolhe um pouco para o canvas continuar do mesmo tamanho).
    TAMANHOS: {
      1: { colunas: 30, linhas: 20, celula: 28 },
      2: { colunas: 32, linhas: 20, celula: 26 },
      3: { colunas: 40, linhas: 26, celula: 21 },
      4: { colunas: 40, linhas: 26, celula: 21 }
    },
    // Meta de vitória antecipada por número de jogadores.
    META_MULTI: { 2: 0.5, 3: 0.35, 4: 0.35 },
    TEMPO_LIMITE: 120,    // segundos de partida no modo com vários jogadores
    MAX_JOGADORES: 4,

    /* ---- ONLINE (Supabase Realtime: só Broadcast + Presence, sem banco) ----
     * A chave publicável é pública por design (pode ficar no código do site).
     * O anfitrião (quem cria a sala) simula a partida; os outros aparelhos só
     * mandam mudanças de direção e desenham o que o anfitrião envia. */
    ONLINE: {
      SUPABASE_URL: 'https://grqjtgoflayhwuspiawc.supabase.co',
      SUPABASE_CHAVE: 'sb_publishable_Ul_-ZY7Y7USJOj5fIJNHAQ_4VYB4Tnt',
      PREFIXO_CODIGO: 'TINTA',      // códigos de sala do tipo TINTA-4821
      // Mensagens de estado do anfitrião por segundo. 6 (não 10): cada mensagem conta
      // 1 + (jogadores - 1) no Supabase; os aparelhos "preveem" o movimento entre
      // uma e outra, então continua suave (issue #5, medido em tests/celular/medir_online.py).
      ENVIOS_POR_SEGUNDO: 6,
      SNAPSHOT_A_CADA: 3,           // segundos entre fotos completas do mapa
      TEMPO_CONEXAO: 8,             // segundos para desistir de conectar
      TEMPO_PROCURAR_SALA: 4,       // segundos esperando o anfitrião aparecer
      TEMPO_TURMA: 20,              // s: entrando na turma, esperando a anfitriã responder
      // Mostrar o campo "Código da sala" no Jogar Online? false (escolhido) = só um link
      // pequeno "Tenho um código" que abre o campo; o ?sala= e o QR continuam usando o código.
      CODIGO_NO_MENU: false,
      NIVEL_DE_QUEM_SAI: 'medio',   // quem sai no meio da partida vira CPU deste nível
      // Tolerância para ausências curtas (aba oculta, celular bloqueado, internet
      // piscando): só depois disso alguém é considerado "fora" (issue #6).
      TOLERANCIA_PARTIDA: 30,       // s: durante a partida (anfitrião fora → outro assume)
      TOLERANCIA_SALA: 60,          // s: na sala de espera
      TEMPO_DESISTIR: 90,           // s: tentando reconectar antes de desistir e voltar ao menu
      SESSAO_VALE: 30 * 60          // s: recarregar a página até 30 min depois volta para a sala
    },

    CORES: {
      gramaClara: '#b8ec8a',
      gramaEscura: '#a6e077',
      bordaIlha: '#7cc35a',
      terra: '#c99a6b',
      terraEscura: '#a87a50',
      sombra: 'rgba(40, 60, 90, 0.18)'
    }
  };

  /* Cores dos jogadores: tinta (território), clara (xadrez), escura (contorno), rastro. */
  IT.CORES_JOGADORES = {
    rosa:    { nome: 'Rosa',    tinta: '#ff7eb6', clara: '#ffb3d4', escura: '#e2589a', rastro: '#ff9cc8' },
    azul:    { nome: 'Azul',    tinta: '#4fa6ff', clara: '#9fcfff', escura: '#2a76d2', rastro: '#7dbcff' },
    amarelo: { nome: 'Amarelo', tinta: '#ffc531', clara: '#ffe08a', escura: '#d18f00', rastro: '#ffd25e' },
    roxo:    { nome: 'Roxo',    tinta: '#a77bff', clara: '#cfb8ff', escura: '#7a4ee0', rastro: '#bf9eff' }
  };
  IT.ORDEM_CORES = ['rosa', 'azul', 'amarelo', 'roxo'];

  /* Níveis da CPU: velocidade relativa e parâmetros usados por ai.js. */
  IT.DIFICULDADES = {
    facil:   { nome: 'Fácil',   velocidade: 0.6 },
    medio:   { nome: 'Médio',   velocidade: 0.72 },
    dificil: { nome: 'Difícil', velocidade: 0.78 },
    // Impossível 😈: anda na mesma velocidade de uma pessoa e tenta te atrapalhar (veja ai.js).
    // (rotulo = texto do botão; o 😈 sobre a cabeça fica reservado para "está caçando")
    desafio: { nome: 'Impossível', rotulo: 'Impossível 😈', velocidade: 1 }
  };

  /*
   * Esquemas de teclado por vaga (J1..J4). O J4 aceita o teclado numérico
   * (8 4 5 6) e também T F G H, para quem não tem teclado numérico.
   */
  IT.CONTROLES = [
    { rotulo: 'W A S D', teclas: { KeyW: 'cima', KeyA: 'esquerda', KeyS: 'baixo', KeyD: 'direita' } },
    { rotulo: 'Setas ↑ ← ↓ →', teclas: { ArrowUp: 'cima', ArrowLeft: 'esquerda', ArrowDown: 'baixo', ArrowRight: 'direita' } },
    { rotulo: 'I J K L', teclas: { KeyI: 'cima', KeyJ: 'esquerda', KeyK: 'baixo', KeyL: 'direita' } },
    { rotulo: 'Numérico 8 4 5 6 ou T F G H', teclas: {
      Numpad8: 'cima', Numpad4: 'esquerda', Numpad5: 'baixo', Numpad6: 'direita',
      KeyT: 'cima', KeyF: 'esquerda', KeyG: 'baixo', KeyH: 'direita' } }
  ];

  /* Direções possíveis (dx, dy). */
  IT.DIRECOES = {
    cima: { x: 0, y: -1 },
    baixo: { x: 0, y: 1 },
    esquerda: { x: -1, y: 0 },
    direita: { x: 1, y: 0 }
  };

  /* Direção oposta, usada para impedir meia-volta de 180°. */
  IT.OPOSTA = { cima: 'baixo', baixo: 'cima', esquerda: 'direita', direita: 'esquerda' };
})(window.IlhasDeTinta);

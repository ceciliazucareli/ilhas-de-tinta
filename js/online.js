/*
 * online.js — partidas online pelo Supabase Realtime (só Broadcast + Presence).
 *
 * Não há servidor do jogo nem banco de dados: o navegador de quem CRIA a sala é
 * o "anfitrião" e roda a simulação de verdade (o mesmo código do modo offline,
 * inclusive as CPUs). O Supabase só repassa mensagens entre os aparelhos.
 *
 *   anfitrião ──(6x/s: posições + células que mudaram; foto completa a cada 3 s)──▶ clientes
 *   clientes  ──(só quando apertam uma tecla: nova direção)──────────────────────────▶ anfitrião
 *
 * Presence mostra quem está na sala. Se o anfitrião sai, os outros voltam ao
 * menu com um aviso. Se um cliente sai no meio da partida, o explorador dele
 * passa a ser jogado pela CPU (nível em config.js) até a partida acabar.
 *
 * TURMA FIXA (?turma=gatinhas-k7m2x, veja turma.js): o canal é sempre o mesmo
 * ("ilhas-de-tinta-TURMA-<id>"). Quem entra procura a anfitriã; se não há
 * ninguém na sala, quem está procurando há mais tempo vira a anfitriã (todos
 * calculam a mesma pessoa pelo Presence: campo "chegou"). Daí em diante é uma
 * sala comum (troca de anfitrião, reconexão, revanche, espectador).
 *
 * Mensagens (eventos de broadcast no canal "ilhas-de-tinta-<CÓDIGO>"):
 *   sala      anfitrião → todos   quem está na sala, cores, CPUs, estado
 *   pedirSala cliente → anfitrião  "acabei de entrar, me mande a sala"
 *   pedirCor  cliente → anfitrião  troca de cor
 *   pedirNome cliente → anfitrião  troca de nome (na sala de espera)
 *   cheia     anfitrião → cliente  sala com 4 jogadores
 *   inicio    anfitrião → todos   configuração da partida que começou
 *   estado    anfitrião → todos   posições, relógio e células que mudaram
 *   snap      anfitrião → todos   foto completa do mapa (de tempos em tempos)
 *   pedirSnap cliente → anfitrião  "perdi mensagens, mande uma foto"
 *   msg       anfitrião → todos   balões de mensagem ("Ops!", "+12!")
 *   fim       anfitrião → todos   ranking final
 *   voltarSala anfitrião → todos  todos voltam para a sala de espera
 *   dir       cliente → anfitrião  nova direção do explorador do cliente
 *   revanche  qualquer um → anfitrião  "quero revanche" (voto)
 *   votos     anfitrião → todos   quem já votou; com todos os humanos, começa outra partida
 *   pedirEstado  cliente → anfitrião  "voltei / cheguei no meio: me mande tudo"
 *   estadoCompleto anfitrião → um  configuração + foto completa (quem reconectou,
 *                                  recarregou ou chegou no meio — esse assiste)
 *   tchau     qualquer um → todos  "saí de propósito" (sem esperar a tolerância)
 *   pausa     anfitrião → todos   partida pausada (motivo: 'menu' ou 'fora' = saiu da tela)
 *   retomar   anfitrião → todos   partida continua
 *
 * Se o anfitrião sai da tela (bloqueou o celular, trocou de app), a partida
 * PAUSA e os outros veem "O anfitrião saiu da tela, esperando…". Se nenhuma
 * mensagem chega por alguns segundos, os outros veem "Esperando o anfitrião…".
 *
 * QUEDAS CURTAS (issue #6): quando o celular bloqueia ou a aba fica oculta, o
 * navegador congela a página e o canal do Supabase cai ("transport failure").
 * Em vez de sair da sala: mostramos "Reconectando…", reabrimos o canal com a
 * MESMA identidade (cid) e pedimos o estado completo. Para os outros, quem some
 * do Presence fica "saiu um pouquinho ⏳" por O.TOLERANCIA_PARTIDA/_SALA
 * segundos antes de contar como saída (na partida, a CPU segura o explorador
 * até a pessoa voltar). Código da sala + identidade ficam no sessionStorage:
 * recarregar a página volta para a sala.
 *
 * TROCA DE ANFITRIÃO: se o anfitrião sai da sala (Presence) ou fica mais de
 * O.TOLERANCIA_PARTIDA segundos fora da tela, o próximo jogador da lista da
 * sala assume (todos calculam o mesmo nome). Ele já tem o mapa, as posições e o
 * relógio: liga as CPUs e continua a partida. O explorador do antigo anfitrião
 * vira CPU; se ele voltar, recebe o controle de volta como jogador comum.
 * Cada troca aumenta sala.eleicao; toda mensagem do anfitrião leva "a" (quem é)
 * e "e" (número da eleição), e vale sempre a eleição mais nova — assim um
 * anfitrião antigo que reapareça percebe e vira jogador comum.
 */
(function (IT) {
  'use strict';

  var O = IT.config.ONLINE;
  var DIRS = ['cima', 'baixo', 'esquerda', 'direita'];
  var el = {};
  var supa = null;      // cliente do Supabase (criado na primeira vez)
  var con = null;       // conexão com a sala atual (ou null)

  function $(id) { return document.getElementById(id); }

  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function gerarId() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  /* Código curto e fácil de ditar: TINTA-4821. */
  function gerarCodigo() {
    return O.PREFIXO_CODIGO + '-' + (1000 + Math.floor(Math.random() * 9000));
  }

  /* Aceita "tinta 4821", "TINTA4821" ou só "4821". */
  function normalizarCodigo(texto) {
    var t = (texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var numeros = t.replace(/^[A-Z]+/, '');
    return /^\d{4}$/.test(numeros) ? O.PREFIXO_CODIGO + '-' + numeros : null;
  }

  function lerNome() {
    var nome = el.nome.value.trim().slice(0, 12);
    if (nome) IT.turma.salvarNome(nome);
    return nome || 'Explorador';
  }

  /* Cor preferida guardada no aparelho (a última que a pessoa escolheu). */
  function corPreferida() { return IT.turma.cor(); }

  function avisoOnline(texto) { el.aviso.textContent = texto || ''; }
  function avisoSala(texto) { el.salaAviso.textContent = texto || ''; }
  function avisoMenu(texto) { el.menuAviso.textContent = texto || ''; }

  function ocupado(sim) {
    el.criar.disabled = sim;
    el.entrar.disabled = sim;
    el.entrarConvite.disabled = sim;
    el.confirmarTurma.disabled = sim;
    el.listaTurmas.querySelectorAll('button').forEach(function (b) { b.disabled = sim; });
  }

  /* Devolve uma mensagem amigável se o online não puder funcionar agora. */
  function motivoIndisponivel() {
    if (location.protocol === 'file:') {
      return 'O modo online só funciona pelo site (endereço http ou https). ' +
        'Abrindo o arquivo direto, dá para jogar Offline! 🏠';
    }
    if (navigator.onLine === false) return 'Parece que não tem internet agora. Que tal jogar Offline? 🏠';
    if (!window.supabase || !window.supabase.createClient) {
      return 'Não consegui carregar o modo online. Confira a internet e tente de novo.';
    }
    return null;
  }

  /* ---------- Conexão com o canal da sala ---------- */

  function clienteSupabase() {
    if (!supa) {
      supa = window.supabase.createClient(O.SUPABASE_URL, O.SUPABASE_CHAVE, {
        auth: { persistSession: false, autoRefreshToken: false },
        // worker: o "batimento" da conexão roda num Web Worker, que o navegador
        // não desacelera quando a aba fica oculta (ajuda a não cair; issue #6).
        // heartbeatIntervalMs: percebe uma conexão morta (Wi-Fi caiu) em ~15 s, não ~60 s.
        realtime: { params: { eventsPerSecond: 40 }, worker: true, heartbeatIntervalMs: 15000 }
      });
    }
    return supa;
  }

  /*
   * Entra no canal da sala; resolve quando estiver conectado.
   * cidSalvo: a mesma identidade de antes (reconexão ou página recarregada).
   */
  function conectar(codigo, anfitriao, nome, cidSalvo) {
    var c = {
      codigo: codigo,
      cid: cidSalvo || gerarId(),
      nome: nome,
      anfitriao: anfitriao,
      canal: null,
      inscrito: false,         // o canal está conectado agora?
      jaConectou: false,
      caiuEm: 0,               // quando o canal caiu (0 = está ok)
      ultimaTentativa: 0,
      presenca: null,          // o que anunciamos no Presence (para repetir ao reconectar)
      historicoStatus: [],     // últimos status do canal (para testes/diagnóstico)
      sala: null,            // estado da sala (o anfitrião é o dono da verdade)
      rodada: 0,
      seq: 0,
      ultimoSeq: -1,
      vistoAnfitriao: false,
      anfitriaoAusenteDesde: 0,
      timers: [],
      copiaDonos: null,
      copiaRastros: null,
      ultimoPedidoSnap: 0,
      fechada: false,
      // Usados pelo game.js através de jogo.rede:
      direcionar: MetodosRede.direcionar,
      preverChegada: MetodosRede.preverChegada,
      jogarDeNovo: MetodosRede.jogarDeNovo,
      mudarJogadores: MetodosRede.mudarJogadores,
      pausar: MetodosRede.pausar,
      retomar: MetodosRede.retomar,
      motivoPausa: 0,          // anfitrião: por que está pausado (0 = não está)
      pausaRemota: 0,          // cliente: o anfitrião avisou que pausou
      ultimaMensagemEm: 0      // cliente: quando chegou o último estado
    };
    c.vigiaConexao = setInterval(function () { vigiarConexao(c); }, 1000);
    return abrirCanal(c, true);
  }

  /* Abre (ou reabre) o canal da sala. Na primeira vez, falha se não conectar. */
  function abrirCanal(c, primeira) {
    var canal = clienteSupabase().channel('ilhas-de-tinta-' + c.codigo, {
      config: { broadcast: { self: false }, presence: { key: c.cid } }
    });
    c.canal = canal;
    c.inscrito = false;
    var ativo = function () { return !c.fechada && c.canal === canal && (con === c || primeira); };

    canal.on('broadcast', { event: '*' }, function (m) {
      if (!ativo() || con !== c) return;
      contar('recebidas', m.event, m.payload);
      try { receber(c, m.event, m.payload || {}); } catch (erro) { console.error('Mensagem online com problema:', erro); }
    });
    canal.on('presence', { event: 'sync' }, function () {
      if (!ativo() || con !== c) return;
      presencaMudou(c);
    });

    return new Promise(function (resolver, rejeitar) {
      var pronto = false;
      var relogio = primeira ? setTimeout(function () {
        if (!pronto) { pronto = true; rejeitar(new Error('tempo esgotado')); }
      }, O.TEMPO_CONEXAO * 1000) : null;
      canal.subscribe(function (status, erro) {
        if (c.canal !== canal || c.fechada) return;
        c.historicoStatus.push(Math.round(performance.now()) + ' ' + status);
        if (c.historicoStatus.length > 30) c.historicoStatus.shift();
        if (status === 'SUBSCRIBED') {
          c.inscrito = true;
          c.caiuEm = 0;
          if (!pronto) { pronto = true; clearTimeout(relogio); resolver(c); }
          if (c.jaConectou) aoReconectar(c);
          c.jaConectou = true;
        } else {
          c.inscrito = false;
          if (!pronto && primeira) {
            pronto = true; clearTimeout(relogio);
            rejeitar(erro || new Error(status));
            return;
          }
          // Caiu depois de conectado (aba congelada, celular bloqueado, rede):
          // NÃO sai da sala — mostra "Reconectando…" e tenta de novo (vigiarConexao).
          if (!c.caiuEm) c.caiuEm = Date.now();
          mostrarReconectando(c, true);
        }
      });
    });
  }

  /* Contagem de mensagens e bytes (issue #5: medir o consumo do plano grátis). */
  var contagem = { enviadas: {}, recebidas: {}, bytesEnviados: 0, bytesRecebidos: 0, desde: Date.now() };
  function contar(tipo, evento, dados) {
    contagem[tipo][evento] = (contagem[tipo][evento] || 0) + 1;
    var n = 0;
    try { n = JSON.stringify(dados).length; } catch (e) { /* ignora */ }
    if (tipo === 'enviadas') contagem.bytesEnviados += n; else contagem.bytesRecebidos += n;
  }

  function enviar(c, evento, dados) {
    if (!c || c.fechada) return;
    if (c.anfitriao && dados && typeof dados === 'object' && c.sala) {
      dados.a = c.cid;                    // quem está mandando como anfitrião
      dados.e = c.sala.eleicao || 0;      // de qual "eleição" de anfitrião
    }
    contar('enviadas', evento, dados);
    c.canal.send({ type: 'broadcast', event: evento, payload: dados }).catch(function (erro) {
      console.warn('Falha ao enviar', evento, erro);
    });
  }

  /* Anuncia (ou repete) quem eu sou no Presence. */
  function rastrear(c, dados) {
    c.presenca = dados;
    return c.canal.track(dados).catch(function () { /* repete ao reconectar */ });
  }

  /* Reabre o canal com a mesma identidade. */
  function reabrir(c) {
    if (c.fechada || c.reabrindo) return;
    c.ultimaTentativa = Date.now();
    c.reabrindo = true;
    var antigo = c.canal;
    // Espera o canal velho sair de verdade: se abrir o novo antes, a desconexão
    // (assíncrona) do velho derruba o novo junto.
    var remover;
    try { remover = Promise.resolve(supa.removeChannel(antigo)); } catch (e) { remover = Promise.resolve(); }
    remover.catch(function () {}).then(function () {
      c.reabrindo = false;
      if (c.fechada || c.canal !== antigo) return;
      abrirCanal(c, false).catch(function () { /* vigiarConexao tenta de novo */ });
    });
  }

  /*
   * Teste de saúde: depois que a página "volta" (descongelou, ficou visível, a
   * internet voltou), o realtime-js às vezes troca o WebSocket por um novo sem
   * reinscrever o canal e sem avisar — o canal parece conectado, mas não recebe
   * nada. Repetimos o anúncio no Presence e esperamos a confirmação do servidor;
   * sem ela, reabrimos o canal.
   */
  function checarSaude(c) {
    if (!c || c.fechada || !c.jaConectou || !c.presenca || c.reabrindo) return;
    var canal = c.canal;
    var tempo = new Promise(function (r) { setTimeout(function () { r('sem resposta'); }, 5000); });
    Promise.race([canal.track(c.presenca), tempo]).then(function (r) {
      if (c.fechada || c.canal !== canal || r === 'ok') return;
      c.inscrito = false;
      if (!c.caiuEm) c.caiuEm = Date.now();
      mostrarReconectando(c, true);
      reabrir(c);
    }, function () {
      if (c.fechada || c.canal !== canal) return;
      c.inscrito = false;
      if (!c.caiuEm) c.caiuEm = Date.now();
      reabrir(c);
    });
  }

  /* Conectou de novo: volta a aparecer na sala e pede o que perdeu. */
  function aoReconectar(c) {
    mostrarReconectando(c, false);
    if (c.presenca) rastrear(c, c.presenca);
    var jogo = IT.jogo;
    if (c.anfitriao) {
      enviar(c, 'sala', c.sala);
      if (jogo.rede === c && jogo.estado === 'jogando') enviarSnapshot(c);
    } else {
      enviar(c, 'pedirSala', { cid: c.cid });
      if (c.sala && (c.sala.estado === 'jogando' || c.sala.estado === 'fim')) enviar(c, 'pedirEstado', { cid: c.cid });
    }
  }

  /* A cada segundo: reconexão e tolerância de ausências (issue #6). */
  function vigiarConexao(c) {
    if (c.fechada || con !== c) return;
    var agora = Date.now();
    if (!c.inscrito && c.caiuEm) {
      if (agora - c.caiuEm > O.TEMPO_DESISTIR * 1000) {
        sair('A conexão caiu e não voltou. 😕 Confira a internet e entre de novo pela sala.');
        return;
      }
      // Tenta reabrir a cada 4 s — também com a aba em segundo plano (computador e
      // Android mantêm a conexão viva assim; no celular bloqueado o JS nem roda).
      if (agora - c.ultimaTentativa > 4000) reabrir(c);
      return; // desconectado: não julga a ausência dos outros com informação velha
    }
    var emPartida = IT.jogo.rede === c && (IT.jogo.estado === 'jogando' || IT.jogo.estado === 'fim');
    var limite = (emPartida ? O.TOLERANCIA_PARTIDA : O.TOLERANCIA_SALA) * 1000;
    if (!c.sala) return;
    if (c.anfitriao) {
      // Quem saiu há mais que a tolerância sai de vez da sala.
      var sairam = c.sala.membros.filter(function (m) { return m.ausenteDesde && agora - m.ausenteDesde > limite; });
      if (sairam.length) {
        c.sala.membros = c.sala.membros.filter(function (m) { return sairam.indexOf(m) === -1; });
        c.sala.cpus = Math.min(c.sala.cpus, IT.config.MAX_JOGADORES - c.sala.membros.length);
        sairam.forEach(function (m) {
          var texto = m.nome + ' não voltou' + (emPartida ? '. A CPU continua no lugar! 🤖' : '. 👋');
          IT.ui.mostrarMensagem(texto, 'aviso');
          enviar(c, 'msg', { texto: texto, tipo: 'aviso', id: 0 });
        });
        if (IT.jogo.estado === 'fim' && IT.jogo.rede === c && c.votos) registrarVoto(c, '-');
        enviar(c, 'sala', c.sala);
        desenharSala();
        salvarSessao(c);
      }
    } else if (c.anfitriaoAusenteDesde && agora - c.anfitriaoAusenteDesde > limite) {
      eleger(c);
    } else if (IT.jogo.estado !== 'jogando' && c.ultimaSalaEm && agora - c.ultimaSalaEm > limite) {
      // Fora da partida o anfitrião reenvia a sala a cada 3 s. Se isso parou, ele
      // sumiu — mesmo que o Presence ainda o mostre (aba congelada com o batimento
      // da conexão rodando num Worker, por exemplo).
      eleger(c);
    } else if (IT.jogo.estado !== 'jogando' && c.ultimaSalaEm && agora - c.ultimaSalaEm > 8000 && !c.anfitriaoAusenteDesde) {
      avisoAusencia(c, 'O anfitrião saiu um pouquinho. Esperando ele voltar… ⏳');
      c.avisoSinalPerdido = true;
    } else if (c.avisoSinalPerdido && c.ultimaSalaEm && agora - c.ultimaSalaEm < 8000) {
      c.avisoSinalPerdido = false;
      avisoAusencia(c, '');
    }
  }

  function mostrarReconectando(c, sim) {
    var texto = 'Reconectando… 🔄';
    var jogo = IT.jogo;
    if (jogo.rede === c && (jogo.estado === 'jogando' || jogo.estado === 'fim')) {
      if (sim) IT.ui.avisoRede(texto);
      else if (document.getElementById('aviso-rede').textContent === texto) IT.ui.avisoRede('');
    } else {
      if (sim) avisoSala(texto);
      else if (el.salaAviso.textContent === texto) avisoSala('');
    }
  }

  /* ---------- Sessão (recarregar a página volta para a sala) ---------- */

  var CHAVE_SESSAO = 'ilhas-de-tinta:sessao';

  function salvarSessao(c) {
    if (!c || c.fechada || !c.sala) return;
    try {
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({
        codigo: c.codigo, cid: c.cid, nome: c.nome, anfitriao: c.anfitriao,
        sala: c.anfitriao ? c.sala : null, turma: c.turma || null, quando: Date.now()
      }));
    } catch (e) { /* sem armazenamento: só não volta sozinho ao recarregar */ }
  }

  function lerSessao() {
    try {
      var s = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null');
      if (s && Date.now() - s.quando < O.SESSAO_VALE * 1000) return s;
    } catch (e) { /* ignora */ }
    return null;
  }

  function limparSessao() {
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignora */ }
  }

  function fechar(c) {
    if (!c || c.fechada) return;
    c.fechada = true;
    clearInterval(c.vigiaConexao);
    c.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    try { supa.removeChannel(c.canal); } catch (e) { /* já fechado */ }
  }

  /* Sai da sala e volta ao menu (com uma mensagem opcional). */
  function sair(mensagem) {
    var c = con;
    con = null;
    // Saída de propósito: avisa os outros para não esperarem a tolerância de quedas.
    if (c && !c.fechada && c.inscrito) enviar(c, 'tchau', { cid: c.cid });
    fechar(c);
    limparSessao();
    IT.ui.avisoRede('');
    IT.ui.modoEspectador(false);
    var jogo = IT.jogo;
    jogo.rede = null;
    jogo.aoAvisar = null;
    jogo.aoFim = null;
    IT.ui.esconderMensagem();
    jogo.irPara('menu');
    avisoMenu(mensagem || '');
  }

  /* ---------- Sala de espera ---------- */

  function coresUsadas(sala, excetoCid) {
    return sala.membros.filter(function (m) { return m.cid !== excetoCid; }).map(function (m) { return m.cor; });
  }

  function primeiraCorLivre(sala, preferida, excetoCid) {
    var usadas = coresUsadas(sala, excetoCid);
    if (preferida && usadas.indexOf(preferida) === -1) return preferida;
    return IT.ORDEM_CORES.filter(function (cor) { return usadas.indexOf(cor) === -1; })[0];
  }

  /* Anfitrião: confere quem está presente e atualiza a sala. */
  function presencaMudou(c) {
    var presentes = presencas(c);
    var agora = Date.now();

    if (!c.anfitriao) {
      // Cliente: o anfitrião continua aqui? Ausência curta só gera um aviso.
      if (!c.sala) return;
      var anf = presentes[c.sala.anfitriao];
      if (anf && anf.semEstado) {
        // O anfitrião recarregou a página e perdeu o estado: outro assume já.
        eleger(c, presentes);
      } else if (anf) {
        c.vistoAnfitriao = true;
        if (c.anfitriaoAusenteDesde) { c.anfitriaoAusenteDesde = 0; avisoAusencia(c, ''); }
      } else if (c.vistoAnfitriao && !c.anfitriaoAusenteDesde) {
        c.anfitriaoAusenteDesde = agora;
        avisoAusencia(c, 'O anfitrião saiu um pouquinho. Esperando ele voltar… ⏳');
      }
      return;
    }

    var sala = c.sala, mudou = false;
    // Quem sumiu: fica "saiu um pouquinho" (a remoção de vez é no vigiarConexao).
    sala.membros.forEach(function (m) {
      if (m.cid === c.cid) return;
      var aqui = !!presentes[m.cid];
      if (!aqui && !m.ausenteDesde) {
        m.ausenteDesde = agora;
        mudou = true;
        comecouAusencia(c, m);
      } else if (aqui && m.ausenteDesde) {
        delete m.ausenteDesde;
        mudou = true;
        acabouAusencia(c, m);
      }
    });
    // Quem chegou.
    Object.keys(presentes).forEach(function (cid) {
      if (cid === c.cid || presentes[cid].papel === 'anfitriao') return;
      if (sala.membros.some(function (m) { return m.cid === cid; })) return;
      // Já estava na partida (caiu e voltou, ou era o anfitrião antigo)? Mesmo nome e cor.
      var antigo = IT.jogo.rede === c ? IT.jogo.jogadores.filter(function (j) { return j.cid === cid; })[0] : null;
      if (sala.membros.length >= IT.config.MAX_JOGADORES && !antigo) {
        enviar(c, 'cheia', { cid: cid });
        return;
      }
      var m = {
        cid: cid,
        nome: antigo ? antigo.nome : String(presentes[cid].nome || 'Explorador').slice(0, 12),
        cor: antigo ? antigo.corNome : primeiraCorLivre(sala, presentes[cid].cor, cid)
      };
      sala.membros.push(m);
      acabouAusencia(c, m);
      mudou = true;
    });
    sala.cpus = Math.min(sala.cpus, IT.config.MAX_JOGADORES - sala.membros.length);
    if (mudou) {
      enviar(c, 'sala', sala);
      desenharSala();
      salvarSessao(c);
    }
  }

  /* Cliente: aviso "o anfitrião saiu um pouquinho" (na partida ou na sala de espera). */
  function avisoAusencia(c, texto) {
    var jogo = IT.jogo;
    if (jogo.rede === c && (jogo.estado === 'jogando' || jogo.estado === 'fim')) {
      if (texto || !c.pausaRemota) IT.ui.avisoRede(texto);
    } else {
      avisoSala(texto);
    }
  }

  /* Anfitrião: alguém sumiu do Presence. Na partida, a CPU segura o explorador. */
  function comecouAusencia(c, membro) {
    var jogo = IT.jogo, texto = membro.nome + ' saiu um pouquinho. Esperando voltar… ⏳';
    if (jogo.rede === c && jogo.estado === 'jogando') {
      jogo.jogadores.forEach(function (j) {
        if (j.cid === membro.cid && j.tipo === 'humano') {
          jogo.transformarEmCPU(j, O.NIVEL_DE_QUEM_SAI);
          texto = membro.nome + ' saiu um pouquinho ⏳ A CPU segura até voltar!';
        }
      });
    }
    IT.ui.mostrarMensagem(texto, 'aviso');
    enviar(c, 'msg', { texto: texto, tipo: 'aviso', id: 0 });
  }

  /* Anfitrião: quem tinha sumido voltou (ou reapareceu depois de recarregar). */
  function acabouAusencia(c, membro) {
    var jogo = IT.jogo;
    if (jogo.rede !== c || jogo.estado !== 'jogando') return;
    jogo.jogadores.forEach(function (j) {
      if (j.cid === membro.cid && j.eraHumano) {
        jogo.devolverParaHumano(j);
        var texto = j.nome + ' voltou! 🎉';
        IT.ui.mostrarMensagem(texto, 'sucesso', j.cor.escura);
        enviar(c, 'msg', { texto: texto, tipo: 'sucesso', id: j.id });
      }
    });
  }

  function botaoOpcao(texto, ativo, aoClicar, desabilitado) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = texto;
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    b.disabled = !!desabilitado;
    b.addEventListener('click', aoClicar);
    return b;
  }

  function nomeCPU(sala, i) {
    var base = 'CPU ' + IT.DIFICULDADES[sala.nivel].nome;
    return sala.cpus > 1 ? base + ' ' + (i + 1) : base;
  }

  /* Desenha a sala de espera (para anfitrião e clientes). */
  function desenharSala() {
    var c = con;
    if (!c || !c.sala) return;
    var sala = c.sala;
    var turma = sala.turma;
    el.salaRotulo.textContent = turma ? 'Turma' : 'Código da sala';
    el.salaCodigo.textContent = turma ? turma.nome + ' 👭' : sala.codigo;
    el.salaCodigo.classList.toggle('sala-codigo-turma', !!turma);
    el.salaConvidar.textContent = turma ? '🔗 Mandar link da turma' : '🔗 Convidar amigos';
    var eu = sala.membros.filter(function (m) { return m.cid === c.cid; })[0];
    el.salaMeuNome.textContent = eu ? eu.nome : c.nome;

    // Lista de quem chegou (+ CPUs que vão completar as vagas).
    el.salaJogadores.innerHTML = '';
    sala.membros.forEach(function (m) {
      var li = document.createElement('li');
      li.style.setProperty('--cor', IT.CORES_JOGADORES[m.cor].tinta);
      li.style.setProperty('--cor-escura', IT.CORES_JOGADORES[m.cor].escura);
      li.innerHTML = '<span class="chip-bolinha"></span><span class="sala-nome"></span><span class="sala-marca"></span>';
      li.querySelector('.sala-nome').textContent = m.nome;
      li.querySelector('.sala-marca').textContent =
        (m.ausenteDesde ? '⏳ saiu um pouquinho ' : '') +
        (m.cid === sala.anfitriao ? '👑 anfitrião' : '') + (m.cid === c.cid ? ' (você)' : '');
      el.salaJogadores.appendChild(li);
    });
    var livres = IT.ORDEM_CORES.filter(function (cor) { return coresUsadas(sala).indexOf(cor) === -1; });
    for (var i = 0; i < sala.cpus; i++) {
      var li = document.createElement('li');
      var cor = IT.CORES_JOGADORES[livres[i]];
      li.style.setProperty('--cor', cor.tinta);
      li.style.setProperty('--cor-escura', cor.escura);
      li.innerHTML = '<span class="chip-bolinha"></span><span class="sala-nome"></span><span class="sala-marca">🤖</span>';
      li.querySelector('.sala-nome').textContent = nomeCPU(sala, i);
      el.salaJogadores.appendChild(li);
    }

    // Minha cor: só dá para escolher uma que ninguém está usando.
    el.salaCores.innerHTML = '';
    IT.ORDEM_CORES.forEach(function (cor) {
      var usada = coresUsadas(sala, c.cid).indexOf(cor) !== -1;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cor-opcao';
      b.style.background = IT.CORES_JOGADORES[cor].tinta;
      b.disabled = usada;
      b.title = IT.CORES_JOGADORES[cor].nome + (usada ? ' (já escolhida)' : '');
      b.setAttribute('aria-label', 'Cor ' + b.title);
      b.setAttribute('aria-pressed', eu && eu.cor === cor ? 'true' : 'false');
      b.addEventListener('click', function () { escolherCor(cor); });
      el.salaCores.appendChild(b);
    });

    // Controles do anfitrião: CPUs para completar, nível e Jogar.
    el.salaAnfitriao.hidden = !c.anfitriao;
    if (c.anfitriao) {
      el.salaCpus.innerHTML = '';
      var maxCpus = IT.config.MAX_JOGADORES - sala.membros.length;
      for (var n = 0; n <= maxCpus; n++) {
        (function (n) {
          el.salaCpus.appendChild(botaoOpcao(String(n), sala.cpus === n, function () {
            sala.cpus = n;
            enviar(c, 'sala', sala);
            desenharSala();
          }));
        })(n);
      }
      el.salaNivel.innerHTML = '';
      Object.keys(IT.DIFICULDADES).forEach(function (chave) {
        el.salaNivel.appendChild(botaoOpcao(IT.DIFICULDADES[chave].rotulo || IT.DIFICULDADES[chave].nome, sala.nivel === chave, function () {
          sala.nivel = chave;
          enviar(c, 'sala', sala);
          desenharSala();
        }));
      });
      el.salaLinhaNivel.hidden = sala.cpus === 0;
      var total = sala.membros.length + sala.cpus;
      el.salaDica.textContent = total < 2
        ? (turma ? 'Mande o link da turma (ou mostre o QR) para seus amigos entrarem, ou coloque uma CPU para jogar com você!'
          : 'Diga este código para seus amigos entrarem, ou coloque uma CPU para jogar com você!')
        : 'Tudo pronto! Aperte Jogar quando todo mundo tiver chegado.';
    } else {
      el.salaDica.textContent = sala.estado === 'jogando' && !IT.jogo.rede
        ? 'Tem uma partida acontecendo agora. Você entra na próxima! ⏳'
        : 'Esperando o anfitrião apertar Jogar… ⏳';
    }
  }

  function escolherCor(cor) {
    var c = con;
    if (!c || !c.sala) return;
    IT.turma.salvarCor(cor); // da próxima vez, começa com esta cor (se estiver livre)
    if (c.anfitriao) {
      var eu = c.sala.membros.filter(function (m) { return m.cid === c.cid; })[0];
      if (eu && coresUsadas(c.sala, c.cid).indexOf(cor) === -1) {
        eu.cor = cor;
        enviar(c, 'sala', c.sala);
        desenharSala();
      }
    } else {
      enviar(c, 'pedirCor', { cid: c.cid, cor: cor });
    }
  }

  /* ---------- Criar sala / entrar ---------- */

  function criarSala() {
    var motivo = motivoIndisponivel();
    if (motivo) { avisoOnline(motivo); return; }
    var nome = lerNome();
    ocupado(true);
    avisoOnline('Criando a sala… ✨');

    var tentativa = 0;
    function tentar() {
      tentativa++;
      var codigo = gerarCodigo();
      return conectar(codigo, true, nome).then(function (c) {
        con = c;
        c.sala = salaNova(c, codigo, null);
        return rastrear(c, { nome: nome, cor: c.sala.membros[0].cor, papel: 'anfitriao' })
          .then(function () { return esperar(800); })
          .then(function () {
            // Código já usado por outra sala? (muito raro) Tenta outro.
            var estado = c.canal.presenceState();
            var outro = Object.keys(estado).some(function (k) {
              return k !== c.cid && estado[k][0] && estado[k][0].papel === 'anfitriao';
            });
            if (outro && tentativa < 3) { con = null; fechar(c); return tentar(); }
            return c;
          });
      });
    }

    tentar().then(comecarComoAnfitriao).catch(function (erro) {
      console.warn('Não foi possível criar a sala:', erro);
      ocupado(false);
      avisoOnline('Não consegui criar a sala agora. 😕 Confira a internet e tente de novo, ou jogue Offline.');
    });
  }

  /* Sala nova com só eu (anfitriã). */
  function salaNova(c, codigo, turma) {
    var sala = {
      codigo: codigo, anfitriao: c.cid,
      membros: [{ cid: c.cid, nome: c.nome, cor: corPreferida() || 'rosa' }],
      cpus: 0, nivel: 'medio', estado: 'espera', rodada: 0
    };
    if (turma) { sala.turma = { id: turma.id, nome: turma.nome }; sala.chegou = c.chegou || 0; }
    return sala;
  }

  /* Acabei de virar a anfitriã de uma sala nova: vai para a sala de espera. */
  function comecarComoAnfitriao(c) {
    ocupado(false);
    avisoOnline('');
    avisoSala('');
    salvarSessao(c);
    IT.jogo.irPara('sala');
    presencaMudou(c);
    desenharSala();
    // De tempos em tempos reenvia a sala (para quem chegou e perdeu alguma mensagem).
    c.timers.push(setInterval(function () { if (c.sala.estado !== 'jogando') enviar(c, 'sala', c.sala); }, 3000));
  }

  /* ---------- Turma: link fixo (?turma=…), sempre a mesma sala ---------- */

  function codigoDaTurma(id) { return 'TURMA-' + id; }

  /* cid: identidade a reusar (quem cedeu a vez de anfitriã continua sendo a mesma pessoa). */
  function entrarNaTurma(id, nomeTurma, cid) {
    var motivo = motivoIndisponivel();
    if (motivo) { avisoOnline(motivo); return; }
    if (con) {
      if (con.turma && con.turma.id === id && con.sala) { IT.jogo.irPara('sala'); return; }
      sair('');
      IT.jogo.irPara('online');
    }
    var turma = { id: id, nome: nomeTurma || IT.turma.nomeDe(id) };
    IT.turma.lembrar(id, turma.nome);
    convitePendente = null;
    desenharOnline();
    var nome = lerNome();
    ocupado(true);
    avisoOnline('Entrando na turma ' + turma.nome + '… 👭');
    var chegou = Date.now();
    conectar(codigoDaTurma(id), false, nome, cid).then(function (c) {
      con = c;
      c.turma = turma;
      c.chegou = chegou;
      return rastrear(c, { nome: nome, cor: corPreferida(), papel: 'jogador', procurando: true, chegou: chegou }).then(function () {
        enviar(c, 'pedirSala', { cid: c.cid });
        procurarAnfitria(c, Date.now(), 0);
      });
    }).catch(function (erro) {
      console.warn('Não foi possível entrar na turma:', erro);
      ocupado(false);
      avisoOnline('Não consegui entrar agora. 😕 Confira a internet e tente de novo, ou jogue Offline.');
    });
  }

  /*
   * Esperando a anfitriã da turma responder. Se não tem ninguém na sala, quem
   * está procurando há mais tempo vira a anfitriã (todos calculam a mesma pessoa).
   * Se há gente na sala mas sem anfitriã (ela acabou de sair), espera a turma
   * escolher outra.
   */
  function procurarAnfitria(c, inicio, voltas) {
    if (con !== c || c.fechada || c.sala) return;
    var agora = Date.now(), presentes = presencas(c);
    var outros = Object.keys(presentes).filter(function (k) { return k !== c.cid; });
    var temAnfitria = outros.some(function (k) { return presentes[k].papel === 'anfitriao'; });
    var temGenteNaSala = outros.some(function (k) { return presentes[k].papel !== 'anfitriao' && !presentes[k].procurando; });
    if (!temAnfitria && !temGenteNaSala && agora - inicio >= 2000) {
      var fila = outros.filter(function (k) { return presentes[k].procurando; })
        .map(function (k) { return { cid: k, chegou: +presentes[k].chegou || 0 }; });
      fila.push({ cid: c.cid, chegou: c.chegou });
      fila.sort(function (a, b) { return a.chegou - b.chegou || (a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0); });
      if (fila[0].cid === c.cid) { virarAnfitriaDaTurma(c); return; }
    }
    var limite = (temGenteNaSala && !temAnfitria ? O.TOLERANCIA_SALA + O.TEMPO_TURMA : O.TEMPO_TURMA) * 1000;
    if (agora - inicio > limite) {
      con = null;
      fechar(c);
      ocupado(false);
      avisoOnline('Não consegui entrar na turma agora. 😕 Tente de novo daqui a pouco.');
      return;
    }
    if (temGenteNaSala && !temAnfitria && voltas === 10) avisoOnline('A turma está escolhendo quem vai ser o anfitrião… ⏳');
    if (voltas % 5 === 4) enviar(c, 'pedirSala', { cid: c.cid });
    c.timers.push(setTimeout(function () { procurarAnfitria(c, inicio, voltas + 1); }, 300));
  }

  function virarAnfitriaDaTurma(c) {
    c.anfitriao = true;
    c.sala = salaNova(c, c.codigo, c.turma);
    rastrear(c, { nome: c.nome, cor: c.sala.membros[0].cor, papel: 'anfitriao', chegou: c.chegou });
    comecarComoAnfitriao(c);
  }

  /*
   * Duas pessoas viraram anfitriãs da turma ao mesmo tempo (o Presence ainda não
   * tinha mostrado uma para a outra). Vale a que chegou primeiro (eleicaoMaisNova);
   * eu viro convidada dela, na mesma sala de espera — e quem estava comigo também.
   */
  function virarConvidadaDaTurma(c, p) {
    c.anfitriao = false;
    c.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    c.timers = [];
    c.sala.anfitriao = p.a;
    c.vistoAnfitriao = true;
    c.ultimaSalaEm = Date.now();
    var eu = c.sala.membros.filter(function (m) { return m.cid === c.cid; })[0];
    rastrear(c, { nome: c.nome, cor: eu ? eu.cor : corPreferida(), papel: 'jogador' });
  }

  function entrarNaSala() {
    var motivo = motivoIndisponivel();
    if (motivo) { avisoOnline(motivo); return; }
    var codigo = normalizarCodigo(el.codigo.value);
    if (!codigo) { avisoOnline('Digite o código da sala, por exemplo ' + O.PREFIXO_CODIGO + '-1234.'); return; }
    el.codigo.value = codigo.split('-')[1];
    var nome = lerNome();
    ocupado(true);
    avisoOnline('Procurando a sala ' + codigo + '… 🔎');

    conectar(codigo, false, nome).then(function (c) {
      con = c;
      return rastrear(c, { nome: nome, cor: corPreferida(), papel: 'jogador' }).then(function () {
        enviar(c, 'pedirSala', { cid: c.cid });
        // Se o anfitrião não responder logo, a sala não existe.
        c.timers.push(setTimeout(function () {
          if (con === c && !c.sala) {
            con = null;
            fechar(c);
            ocupado(false);
            avisoOnline('Não achei a sala ' + codigo + '. Confira o código com quem criou! 🔎');
          }
        }, O.TEMPO_PROCURAR_SALA * 1000));
        c.timers.push(setTimeout(function () { if (con === c && !c.sala) enviar(c, 'pedirSala', { cid: c.cid }); }, 1500));
      });
    }).catch(function (erro) {
      console.warn('Não foi possível entrar na sala:', erro);
      ocupado(false);
      avisoOnline('Não consegui entrar agora. 😕 Confira a internet e tente de novo, ou jogue Offline.');
    });
  }

  /* ---------- Partida: anfitrião ---------- */

  function configuracaoDaSala(c) {
    var sala = c.sala;
    var vagas = sala.membros.map(function (m) {
      return { tipo: 'humano', cor: m.cor, nome: m.nome, cid: m.cid, dificuldade: 'medio' };
    });
    var livres = IT.ORDEM_CORES.filter(function (cor) { return coresUsadas(sala).indexOf(cor) === -1; });
    for (var i = 0; i < sala.cpus; i++) {
      vagas.push({ tipo: 'cpu', cor: livres[i], nome: nomeCPU(sala, i), dificuldade: sala.nivel });
    }
    return { vagas: vagas };
  }

  function comecarPartida() {
    var c = con;
    if (!c || !c.anfitriao) return;
    var configuracao = configuracaoDaSala(c);
    if (configuracao.vagas.length < 2) {
      avisoSala('Precisa de pelo menos 2 jogadores: chame um amigo ou coloque uma CPU! 🙂');
      return;
    }
    avisoSala('');
    c.votos = {};
    c.sala.estado = 'jogando';
    c.sala.rodada++;
    c.rodada = c.sala.rodada;
    c.seq = 0;
    // 'inicio' antes de 'sala': quem recebe a sala já "jogando" sem ter recebido o
    // início acharia que chegou no meio e pediria o estado completo à toa.
    enviar(c, 'inicio', { r: c.rodada, configuracao: JSON.parse(JSON.stringify(configuracao)) });
    enviar(c, 'sala', c.sala);

    var jogo = IT.jogo;
    jogo.rede = c;
    ligarGanchosDoAnfitriao(c);
    // Cada vaga humana: joga aqui só o próprio anfitrião; os outros, pela rede.
    configuracao.vagas.forEach(function (v) { v.local = v.cid === c.cid || v.tipo === 'cpu'; });
    jogo.jogar(configuracao);
    c.configuracaoAtual = JSON.parse(JSON.stringify(configuracao));
    // Quem saiu um pouquinho começa com a CPU segurando o explorador.
    c.sala.membros.forEach(function (m) {
      if (!m.ausenteDesde) return;
      jogo.jogadores.forEach(function (j) { if (j.cid === m.cid) jogo.transformarEmCPU(j, O.NIVEL_DE_QUEM_SAI); });
    });
    enviarSnapshot(c);
    transmitir(c);
    salvarSessao(c);
  }

  /* Anfitrião: estado completo para quem voltou, recarregou ou chegou no meio. */
  function enviarEstadoCompleto(c, cid) {
    var jogo = IT.jogo;
    if (jogo.rede !== c || (jogo.estado !== 'jogando' && jogo.estado !== 'fim')) return;
    var g = jogo.grade;
    var config = JSON.parse(JSON.stringify(c.configuracaoAtual || jogo.configuracao));
    config.vagas.forEach(function (v) { delete v.local; });
    enviar(c, 'estadoCompleto', {
      para: cid, r: c.rodada, configuracao: config, estadoJogo: jogo.estado,
      s: c.seq, t: Math.round(jogo.tempoRestante * 10) / 10, j: resumoJogadores(),
      d: Array.prototype.join.call(g.donos, ''), k: Array.prototype.join.call(g.rastros, ''),
      ranking: jogo.estado === 'fim' ? jogo.ranking().map(function (r) { return [r.jogador.id, r.celulas]; }) : null
    });
  }

  /* Anfitrião: avisos e fim da partida vão para todos os aparelhos. */
  function ligarGanchosDoAnfitriao(c) {
    var jogo = IT.jogo;
    jogo.aoAvisar = function (texto, tipo, id, de) { enviar(c, 'msg', { texto: texto, tipo: tipo, id: id, de: de || 0 }); };
    jogo.aoFim = function (lista, porTempo) {
      enviarSnapshot(c);
      enviar(c, 'fim', {
        r: c.rodada,
        porTempo: porTempo,
        ranking: lista.map(function (r) { return [r.jogador.id, r.celulas]; })
      });
      c.sala.estado = 'fim';
    };
  }

  /* Anfitrião: manda o estado O.ENVIOS_POR_SEGUNDO (6) vezes por segundo, com foto completa de tempos em tempos. */
  function transmitir(c) {
    var jogo = IT.jogo;
    c.timers.forEach(function (t) { clearInterval(t); });
    c.timers = [];
    var envios = 0;
    var porSnapshot = Math.round(O.SNAPSHOT_A_CADA * O.ENVIOS_POR_SEGUNDO);
    c.timers.push(setInterval(function () {
      if (jogo.rede !== c || jogo.estado !== 'jogando') return;
      envios++;
      // Pausado: nada muda — manda só 1 por segundo (para ninguém achar que caiu).
      if (jogo.pausado && envios % O.ENVIOS_POR_SEGUNDO !== 0) return;
      if (envios % porSnapshot === 0) enviarSnapshot(c);
      else enviarEstado(c);
    }, 1000 / O.ENVIOS_POR_SEGUNDO));
    c.timers.push(setInterval(function () { if (c.sala.estado !== 'jogando') enviar(c, 'sala', c.sala); }, 3000));
  }

  /* ---------- Troca de anfitrião ---------- */

  function presencas(c) {
    var estado = c.canal.presenceState(), presentes = {};
    Object.keys(estado).forEach(function (k) { presentes[k] = (estado[k] || [])[0] || {}; });
    return presentes;
  }

  /*
   * Cliente: o anfitrião sumiu. Escolhe o próximo da lista da sala que ainda
   * está aqui (todos os aparelhos chegam ao mesmo nome). Se for eu, assumo.
   */
  function eleger(c, presentes) {
    if (c.anfitriao || !c.sala) return;
    presentes = presentes || presencas(c);
    var antigo = c.sala.anfitriao;
    var candidatos = c.sala.membros.filter(function (m) {
      return m.cid !== antigo && (m.cid === c.cid || presentes[m.cid]);
    });
    if (!candidatos.length) {
      sair('O anfitrião saiu da sala. 👋 Que tal criar uma sala nova?');
      return;
    }
    var novo = candidatos[0];
    c.sala.anfitriao = novo.cid;
    c.sala.eleicao = (c.sala.eleicao || 0) + 1;
    c.vistoAnfitriao = true;
    c.ultimaMensagemEm = Date.now();
    c.foraDesde = 0;
    c.anfitriaoAusenteDesde = 0;
    c.ultimaSalaEm = Date.now();
    c.avisoSinalPerdido = false;
    if (novo.cid === c.cid) {
      assumir(c, antigo);
    } else {
      mostrarPausaRemota(c, 'troca');
      IT.ui.avisoRede('O anfitrião saiu. ' + novo.nome + ' vai continuar a partida… 👑');
    }
  }

  /* Volta para a casa mais perto (o cliente não sabia o "último lugar seguro"). */
  function casaMaisPerto(j) {
    var g = IT.jogo.grade, e = j.explorador;
    if (g.dono(e.x, e.y) === j.id) return { x: e.x, y: e.y };
    var caminho = g.buscarCaminho(e.x, e.y, function (x, y) { return g.dono(x, y) === j.id; }, function () { return false; });
    return caminho ? caminho[caminho.length - 1] : { x: j.inicio.x, y: j.inicio.y };
  }

  /* Este aparelho vira o anfitrião e continua a partida de onde estava. */
  function assumir(c, antigo) {
    var jogo = IT.jogo;
    c.anfitriao = true;
    c.motivoPausa = 0;
    c.pausaRemota = 0;
    c.foraDesde = 0;
    c.votos = {};
    c.sala.anfitriao = c.cid;
    c.sala.membros = c.sala.membros.filter(function (m) { return m.cid !== antigo; });
    var eu = c.sala.membros.filter(function (m) { return m.cid === c.cid; })[0];
    rastrear(c, { nome: c.nome, cor: eu ? eu.cor : null, papel: 'anfitriao' });

    if (jogo.rede === c && (jogo.estado === 'jogando' || jogo.estado === 'fim')) {
      jogo.jogadores.forEach(function (j) {
        if (j.cid === antigo && j.tipo === 'humano') {
          jogo.transformarEmCPU(j, O.NIVEL_DE_QUEM_SAI);
        } else if (j.tipo === 'cpu') {
          j.local = true;
          if (!j.ia) { j.ia = IT.ia.criar(j, jogo); j.explorador.controlador = j.ia; }
        } else {
          j.local = j.cid === c.cid;
        }
        // O que só o anfitrião sabia: onde é "casa" e se tem rastro aberto.
        j.ultimoSeguro = casaMaisPerto(j);
        j.explorador.travarMeiaVolta = jogo.grade.temRastro(j.id);
      });
      ligarGanchosDoAnfitriao(c);
      jogo.pausado = false;
      c.seq = c.ultimoSeq + 1;
      IT.ui.avisoRede('');
      if (jogo.estado === 'jogando') enviarSnapshot(c);
      transmitir(c);
    } else {
      transmitir(c);
      desenharSala();
    }
    c.configuracaoAtual = c.configuracaoAtual || JSON.parse(JSON.stringify(jogo.configuracao));
    enviar(c, 'sala', c.sala);
    salvarSessao(c);
    var texto = c.nome + ' agora é o anfitrião 👑';
    IT.ui.mostrarMensagem(texto, 'sucesso');
    enviar(c, 'msg', { texto: texto, tipo: 'sucesso', id: 0 });
  }

  /*
   * Eu era anfitrião, mas outro assumiu numa eleição mais nova (eu estava fora
   * da tela ou sem internet). Continuo na partida como jogador comum.
   */
  function virarCliente(c, p) {
    var jogo = IT.jogo;
    c.anfitriao = false;
    c.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    c.timers = [];
    c.vigiando = false;
    c.sala.anfitriao = p.a;
    c.sala.eleicao = p.e || 0;
    c.vistoAnfitriao = true;
    c.ultimaMensagemEm = Date.now();
    c.ultimoSeq = -1;
    jogo.aoAvisar = null;
    jogo.aoFim = null;
    jogo.pausado = false;
    // Só pede o explorador de volta quando a pessoa estiver olhando a tela;
    // enquanto o celular estiver bloqueado, a CPU continua jogando por ela.
    if (document.visibilityState === 'visible') voltarComoJogador(c);
    else c.esperandoVoltar = true;
    if (jogo.rede === c) {
      jogo.jogadores.forEach(function (j) {
        j.ia = null;
        j.explorador.controlador = null;
        j.local = j.cid === c.cid;
        if (j.cid === c.cid) j.tipo = 'humano';
      });
      c.vigiando = true;
      vigiarAnfitriao(c);
    }
    IT.ui.mostrarMensagem('Você ficou fora e outro jogador virou o anfitrião. Pode continuar jogando! 🙂', 'aviso');
    // Voltou na tela de pausa ("todo mundo esperando você")? Agora não é mais assim.
    if (jogo.menuAberto) IT.ui.configurarPausa('Bem-vindo de volta! 👋', 'Outro jogador virou o anfitrião enquanto você estava fora. Toque em Continuar para jogar!');
    desenharSala();
    salvarSessao(c);
  }

  /* Avisa a sala que estou aqui como jogador (o anfitrião devolve meu explorador). */
  function voltarComoJogador(c) {
    c.esperandoVoltar = false;
    var eu = c.sala.membros.filter(function (m) { return m.cid === c.cid; })[0];
    rastrear(c, { nome: c.nome, cor: eu ? eu.cor : null, papel: 'jogador' });
  }

  /* A mensagem veio de um anfitrião de uma eleição mais nova que a minha? */
  function eleicaoMaisNova(c, p) {
    if (!p || !p.a || !c.sala) return false;
    var minha = c.sala.eleicao || 0, dela = p.e || 0;
    if (dela !== minha) return dela > minha;
    // Turma: duas anfitriãs que começaram juntas — vale quem chegou primeiro
    // (só a mensagem 'sala' traz "chegou"; as outras esperam por ela).
    if (c.sala.turma && p.turma && p.chegou !== undefined) {
      var minhaChegada = c.sala.chegou || 0;
      return p.chegou < minhaChegada || (p.chegou === minhaChegada && p.a < c.sala.anfitriao);
    }
    // Mesma eleição com dois anfitriões (raro): fica quem vem antes na lista da sala.
    var ordem = function (cid) {
      var i = c.sala.membros.map(function (m) { return m.cid; }).indexOf(cid);
      return i === -1 ? 99 : i;
    };
    return ordem(p.a) < ordem(c.sala.anfitriao);
  }

  function resumoJogadores() {
    return IT.jogo.jogadores.map(function (j) {
      var e = j.explorador;
      return [e.x, e.y, e.alvoX, e.alvoY, Math.round(e.progresso * 100),
        e.direcao ? DIRS.indexOf(e.direcao) : -1, DIRS.indexOf(e.ultimaDirecao), j.cacando ? 1 : 0,
        j.ultimaEntrada || 0,   // [8] última virada do jogador já aplicada (previsão, issue #7)
        e.saltos || 0];         // [9] quantas vezes foi teleportado ("Ops!", renascer): o cliente corrige na hora
    });
  }

  /* Envia só as células que mudaram desde a última mensagem: [índice, dono, rastro, ...]. */
  function enviarEstado(c) {
    var g = IT.jogo.grade, mudancas = [];
    for (var i = 0; i < g.total; i++) {
      if (g.donos[i] !== c.copiaDonos[i] || g.rastros[i] !== c.copiaRastros[i]) {
        mudancas.push(i, g.donos[i], g.rastros[i]);
        c.copiaDonos[i] = g.donos[i];
        c.copiaRastros[i] = g.rastros[i];
      }
    }
    enviar(c, 'estado', {
      r: c.rodada, s: c.seq++, pa: IT.jogo.pausado ? c.motivoPausa || 'menu' : 0,
      t: Math.round(IT.jogo.tempoRestante * 10) / 10,
      j: resumoJogadores(),
      c: mudancas
    });
  }

  /* Foto completa do mapa: dono e rastro de cada célula como texto ("0".."4"). */
  function enviarSnapshot(c) {
    var g = IT.jogo.grade;
    c.copiaDonos = new Uint8Array(g.donos);
    c.copiaRastros = new Uint8Array(g.rastros);
    enviar(c, 'snap', {
      r: c.rodada, s: c.seq++,
      t: Math.round(IT.jogo.tempoRestante * 10) / 10,
      j: resumoJogadores(),
      d: Array.prototype.join.call(g.donos, ''),
      k: Array.prototype.join.call(g.rastros, '')
    });
  }

  /*
   * Anfitrião (issue #7): a virada chega com a célula onde a pessoa quis virar
   * (x, y) — a próxima em que o explorador dela chegaria. Por causa do atraso da
   * internet, o explorador aqui pode já ter passado por essa célula: se passou
   * há pouco (e seguiu reto), "rebobina" e vira de lá; se ainda vai chegar, vira
   * ao chegar. Assim a virada acontece na célula certa, como no modo offline.
   */
  var estatViradas = { exatas: 0, rebobinadas: 0, atrasadas: 0, agendadas: 0, antigoAtrasaria: 0 };
  function aplicarViradaRemota(c, j, d, p) {
    var e = j.explorador;
    j.ultimaEntrada = Math.max(j.ultimaEntrada || 0, p.n || 0);
    if (typeof p.x !== 'number') { e.pedirDirecao(d); return; }
    // Já tem virada esperando a sua célula: esta vem depois dela, na fila.
    if (j.viradasAgendadas && j.viradasAgendadas.length) {
      j.viradasAgendadas.push({ x: p.x, y: p.y, d: d, esperou: 0 });
      estatViradas.agendadas++;
      return;
    }
    // No modelo antigo a virada valia "na próxima célula" do anfitrião: atrasaria se ela não for a pedida.
    if (!(e.direcao && e.alvoX === p.x && e.alvoY === p.y) && !(!e.direcao && e.x === p.x && e.y === p.y)) estatViradas.antigoAtrasaria++;
    if (!e.direcao || (e.alvoX === p.x && e.alvoY === p.y)) {
      e.pedirDirecao(d);
      estatViradas.exatas++;
      return;
    }
    // Ele ainda não chegou na célula da virada (a mensagem chegou antes da hora):
    // guarda a virada para quando chegar lá.
    if (e.direcao && aFrenteNaLinha(e, p.x, p.y)) {
      j.viradasAgendadas = [{ x: p.x, y: p.y, d: d, esperou: 0 }];
      estatViradas.agendadas++;
      return;
    }
    if (rebobinar(j, d, p.x, p.y)) {
      estatViradas.rebobinadas++;
    } else {
      e.pedirDirecao(d);
      estatViradas.atrasadas++;
    }
  }
  function jogo() { return IT.jogo; }

  /* (x, y) está à frente na linha em que o explorador anda (até 8 células depois do alvo)? */
  function aFrenteNaLinha(e, x, y) {
    var v = IT.DIRECOES[e.direcao], dx = x - e.alvoX, dy = y - e.alvoY;
    if (v.x) return dy === 0 && dx * v.x > 0 && Math.abs(dx) <= 8;
    return dx === 0 && dy * v.y > 0 && Math.abs(dy) <= 8;
  }

  /*
   * O explorador já passou da célula (x, y) há até 2 células, seguindo reto e só
   * pintando rastro: desfaz esse rastro "a mais", volta para (x, y) e vira de lá.
   */
  function rebobinar(j, d, x, y) {
    var e = j.explorador, g = jogo().grade, hist = j.historico || [];
    var k = -1;
    for (var i = hist.length - 1; i >= 0; i--) if (hist[i].x === x && hist[i].y === y) { k = i; break; }
    if (k < 0 || hist.length - 1 - k > O.REBOBINAR_CELULAS) return false;
    // Direção em que ele saiu de (x, y): de hist[k] para a próxima chegada (ou para o alvo atual).
    var prox = hist[k + 1] || { x: e.alvoX, y: e.alvoY };
    var saida = null;
    Object.keys(IT.DIRECOES).forEach(function (nome) {
      var v = IT.DIRECOES[nome];
      if (x + v.x === prox.x && y + v.y === prox.y) saida = nome;
    });
    if (!saida || d === saida || d === IT.OPOSTA[saida]) return false;
    var v = IT.DIRECOES[d];
    if (!g.dentro(x + v.x, y + v.y)) return false;
    // Desfaz o rastro pintado depois de (x, y).
    for (var m = k + 1; m < hist.length; m++) {
      if (hist[m].pintou && g.rastro(hist[m].x, hist[m].y) === j.id) g.setRastro(hist[m].x, hist[m].y, 0);
    }
    j.historico = hist.slice(0, k + 1);
    e.x = x; e.y = y;
    e.direcao = d;
    e.ultimaDirecao = d;
    e.alvoX = x + v.x;
    e.alvoY = y + v.y;
    e.proximaDirecao = null;
    e.filaDirecao = null;
    e.travarMeiaVolta = g.temRastro(j.id);
    return true;
  }

  /* ---------- Revanche (votação) ---------- */

  /* Humanos que jogaram esta partida e continuam na sala. */
  function humanosDaPartida(c) {
    var presentes = (c.sala ? c.sala.membros : []).map(function (m) { return m.cid; });
    return IT.jogo.jogadores.filter(function (j) {
      return j.tipo === 'humano' && j.cid && presentes.indexOf(j.cid) !== -1;
    });
  }

  /* Anfitrião: registra um voto, avisa todos e começa quando todos votaram. */
  function registrarVoto(c, cid) {
    if (!c.anfitriao || IT.jogo.rede !== c || IT.jogo.estado !== 'fim') return;
    c.votos = c.votos || {};
    c.votos[cid] = true;
    var humanos = humanosDaPartida(c);
    var votaram = humanos.filter(function (j) { return c.votos[j.cid]; });
    var nomes = votaram.map(function (j) { return j.nome; });
    var cids = votaram.map(function (j) { return j.cid; });
    enviar(c, 'votos', { nomes: nomes, cids: cids, total: humanos.length });
    IT.ui.mostrarVotosRevanche(nomes, humanos.length, !!c.votos[c.cid]);
    if (votaram.length >= humanos.length && !c.revancheMarcada) {
      c.revancheMarcada = true;
      IT.ui.mostrarMensagem('Todo mundo quer revanche! 🔁', 'sucesso');
      enviar(c, 'msg', { texto: 'Todo mundo quer revanche! 🔁', tipo: 'sucesso', id: 0 });
      setTimeout(function () {
        c.revancheMarcada = false;
        if (con === c && IT.jogo.estado === 'fim') comecarPartida();
      }, 1200);
    }
  }

  /* ---------- Partida: cliente ---------- */

  function aplicarJogadores(lista, c) {
    var jogadores = IT.jogo.jogadores;
    lista.forEach(function (p, i) {
      var e = jogadores[i] && jogadores[i].explorador;
      if (!e) return;
      if (c && jogadores[i].tipo === 'humano' && jogadores[i].local && reconciliar(c, jogadores[i], p)) return;
      if (c && seguirPrevisaoDosOutros(e, p)) { jogadores[i].cacando = !!p[7]; return; }
      e.x = p[0]; e.y = p[1]; e.alvoX = p[2]; e.alvoY = p[3];
      e.progresso = p[4] / 100;
      e.direcao = p[5] >= 0 ? DIRS[p[5]] : null;
      e.ultimaDirecao = DIRS[p[6]] || e.ultimaDirecao;
      jogadores[i].cacando = !!p[7]; // Impossível 😈 caçando (mostra o aviso)
    });
  }

  /*
   * Cliente (issue #7): o meu explorador anda por previsão aqui. Quando chega o
   * estado do anfitrião (um pouco "velho", pelo atraso da internet), mantém a
   * previsão se ela bate; senão vai para a posição do anfitrião deslizando.
   * Devolve true se manteve a previsão.
   */
  var medidasVirada = { pedidas: 0, mostradaNaHoraMs: [], anfitriaoConfirmouMs: [], correcoes: 0, mantidas: 0 };
  function reconciliar(c, j, p) {
    var e = j.explorador;
    var ack = p[8] || 0, pendente = (c.entradas || 0) > ack;
    if (c.viradaPendente && ack >= c.viradaPendente.n && p[5] === DIRS.indexOf(c.viradaPendente.d)) {
      var ida = Date.now() - c.viradaPendente.quando;
      medidasVirada.anfitriaoConfirmouMs.push(ida);
      // Atraso de ida e volta até o anfitrião (média móvel): quanto a previsão pode estar à frente.
      c.atrasoMs = c.atrasoMs ? c.atrasoMs * 0.75 + ida * 0.25 : ida;
      c.viradaPendente = null;
    }
    var hx = p[0] + (p[2] - p[0]) * p[4] / 100, hy = p[1] + (p[3] - p[1]) * p[4] / 100;
    j.cacando = !!p[7];
    var saltou = p[9] !== undefined && e.saltosVistos !== undefined && p[9] !== e.saltosVistos;
    if (p[9] !== undefined) e.saltosVistos = p[9];
    if (!saltou && anfitriaoNoMeuCaminho(e, p, pendente, celulasDeFolga(c, e))) {
      medidasVirada.mantidas++;
      return true; // a previsão está certa: o anfitrião só está atrás, pelo atraso da internet
    }
    // Divergiu (Ops!, corte, virada que o anfitrião não aceitou...): vai para a posição dele, deslizando.
    medidasVirada.correcoes++;
    desfazerPrevistos(c);
    var de = e.posicaoVisual();
    e.x = p[0]; e.y = p[1]; e.alvoX = p[2]; e.alvoY = p[3];
    e.progresso = p[4] / 100;
    e.direcao = p[5] >= 0 ? DIRS[p[5]] : null;
    e.ultimaDirecao = DIRS[p[6]] || e.ultimaDirecao;
    e.proximaDirecao = null;
    e.caminho = [];
    if (Math.abs(de.x - hx) + Math.abs(de.y - hy) < 4) e.corrigirSuave(de.x, de.y); // teleporte grande: sem deslizar
    // Uma virada minha que o anfitrião ainda não aplicou continua pedida.
    if (pendente && c.viradaPendente) e.pedirDirecao(c.viradaPendente.d);
    return true;
  }

  /*
   * O estado do anfitrião (que chega "velho", pelo atraso da internet) bate com
   * a minha previsão? Bate se a célula onde ele está faz parte do caminho que
   * eu acabei de fazer, indo para a mesma célula seguinte. (Antes comparávamos
   * com a posição de AGORA: com ~300 ms de atraso, o anfitrião está 2 células
   * atrás, ou ainda não chegou na célula da virada, e o explorador era puxado
   * para trás à toa.) Com uma virada minha que ele ainda não recebeu
   * (pendente), basta a célula estar no caminho.
   */
  /* Quantas células a minha previsão pode estar à frente do anfitrião: atraso × velocidade + folga. */
  function celulasDeFolga(c, e) {
    var atraso = Math.max(c.atrasoMs || 400, 250) / 1000;
    var cps = IT.config.VELOCIDADE * (e.velocidade || 1);
    return Math.max(4, Math.min(14, Math.ceil(atraso * 1.3 * cps) + 2));
  }

  function anfitriaoNoMeuCaminho(e, p, pendente, folga) {
    var parado = p[0] === p[2] && p[1] === p[3];
    // Os dois parados na mesma célula: igual.
    if (parado && !e.direcao && p[0] === e.x && p[1] === e.y) return true;
    var cam = (e.caminho || []).concat([e.x, e.y]);   // células de onde saí + a atual
    if (e.direcao) cam.push(e.alvoX, e.alvoY);
    // Só as últimas células que o atraso explica (folga): mais que isso não é atraso,
    // é divergência — senão o explorador "sai correndo" sozinho.
    // ("Ops!" e renascer o anfitrião avisa à parte — p[9] — e aí corrige sempre.)
    var limite = Math.max(0, cam.length - 2 * folga), perto = Infinity;
    for (var k = cam.length - 2; k >= limite; k -= 2) {
      perto = Math.min(perto, Math.abs(cam[k] - p[0]) + Math.abs(cam[k + 1] - p[1]));
      if (cam[k] !== p[0] || cam[k + 1] !== p[1]) continue;
      if (parado) return true;        // ainda não aplicou o começo de um movimento meu
      if (k + 2 < cam.length && cam[k + 2] === p[2] && cam[k + 3] === p[3]) return true;
      if (pendente) return true;
    }
    // Virada minha que ele ainda não recebeu: ele passa reto da célula da virada e,
    // quando a mensagem chegar, "rebobina" até lá (game.js/online.js). Não corrige
    // enquanto ele estiver a poucas células do meu caminho.
    return pendente && perto <= Math.min(O.REBOBINAR_CELULAS, folga);
  }

  /*
   * Os exploradores dos OUTROS também andam aqui entre uma mensagem e outra
   * (6 por segundo). A mensagem do anfitrião é um pouco "velha" (atraso da
   * internet): se ele está na mesma direção e até 1,5 célula atrás da nossa
   * previsão, mantemos a previsão (senão ele "voltaria" a cada mensagem);
   * se divergiu (virou, Ops!), vai para a posição certa deslizando.
   */
  function seguirPrevisaoDosOutros(e, p) {
    var hx = p[0] + (p[2] - p[0]) * p[4] / 100, hy = p[1] + (p[3] - p[1]) * p[4] / 100;
    var dirH = p[5] >= 0 ? DIRS[p[5]] : null;
    var minha = e.posicaoVisual();
    var px_ = minha.x - (e.ajusteX || 0), py_ = minha.y - (e.ajusteY || 0);
    if (dirH && dirH === e.direcao) {
      var v = IT.DIRECOES[dirH];
      var aFrente = (px_ - hx) * v.x + (py_ - hy) * v.y;           // quanto a previsão está à frente
      var deLado = Math.abs((px_ - hx) * v.y) + Math.abs((py_ - hy) * v.x);
      if (aFrente >= -0.05 && aFrente <= 1.5 && deLado < 0.05) return true;
    }
    var de = e.posicaoVisual();
    e.x = p[0]; e.y = p[1]; e.alvoX = p[2]; e.alvoY = p[3];
    e.progresso = p[4] / 100;
    e.direcao = dirH;
    e.ultimaDirecao = DIRS[p[6]] || e.ultimaDirecao;
    e.proximaDirecao = null;
    if (Math.abs(de.x - hx) + Math.abs(de.y - hy) < 4) e.corrigirSuave(de.x, de.y);
    return true;
  }

  function aplicarEstado(c, p, foto) {
    var jogo = IT.jogo;
    if (jogo.rede !== c || p.r !== c.rodada || (jogo.estado !== 'jogando' && jogo.estado !== 'fim')) return;
    var g = jogo.grade;
    // Rastro previsto (meu): guarda o que era do anfitrião antes de sobrescrever.
    var tocadas = foto ? null : {};
    if (foto) {
      for (var i = 0; i < g.total; i++) {
        g.donos[i] = p.d.charCodeAt(i) - 48;
        g.rastros[i] = p.k.charCodeAt(i) - 48;
      }
    } else {
      for (var k = 0; k < p.c.length; k += 3) {
        g.donos[p.c[k]] = p.c[k + 1];
        g.rastros[p.c[k]] = p.c[k + 2];
        tocadas[p.c[k]] = true;
      }
      // Pulou mensagens? Pede uma foto completa (no máximo a cada 2 s).
      if (c.ultimoSeq >= 0 && p.s > c.ultimoSeq + 1 && Date.now() - c.ultimoPedidoSnap > 2000) {
        c.ultimoPedidoSnap = Date.now();
        enviar(c, 'pedirSnap', { cid: c.cid });
      }
    }
    conferirPrevistos(c, tocadas);
    c.ultimoSeq = Math.max(c.ultimoSeq, p.s);
    c.ultimaMensagemEm = Date.now();
    if (!foto) mostrarPausaRemota(c, p.pa || 0);
    if (jogo.estado === 'jogando') {
      aplicarJogadores(p.j, c);
      jogo.tempoRestante = p.t;
      IT.ui.atualizarHUD(jogo);
      IT.ui.atualizarRelogio(p.t);
    }
  }

  var TEXTOS_PAUSA = {
    fora: 'O anfitrião saiu da tela. Esperando ele voltar… ⏳',
    menu: 'O anfitrião pausou o jogo. ⏸',
    troca: 'O anfitrião saiu. Outro jogador vai continuar a partida… 👑',
    lento: 'Esperando o anfitrião… ⏳'
  };

  function mostrarPausaRemota(c, motivo) {
    if (motivo === 'fora' && c.pausaRemota !== 'fora') c.foraDesde = Date.now();
    if (motivo !== 'fora') c.foraDesde = 0;
    c.pausaRemota = motivo || 0;
    IT.ui.avisoRede(motivo ? TEXTOS_PAUSA[motivo] || TEXTOS_PAUSA.menu : '');
  }

  /* Cliente: se as mensagens do anfitrião param de chegar, avisa. */
  function vigiarAnfitriao(c) {
    c.timers.push(setInterval(function () {
      var jogo = IT.jogo;
      if (con !== c || c.anfitriao || jogo.rede !== c || jogo.estado !== 'jogando') return;
      // Anfitrião fora da tela há muito tempo (ou sumiu de vez): o próximo assume.
      if (!c.inscrito) return; // eu é que estou sem conexão: não julgo o anfitrião
      var foraMuito = c.pausaRemota === 'fora' && c.foraDesde && Date.now() - c.foraDesde > O.TOLERANCIA_PARTIDA * 1000;
      var mudo = Date.now() - c.ultimaMensagemEm > O.TOLERANCIA_PARTIDA * 1000;
      if (foraMuito || mudo) { eleger(c); return; }
      var parado = Date.now() - c.ultimaMensagemEm > 2500;
      if (parado && !c.pausaRemota) mostrarPausaRemota(c, 'lento');
      else if (!parado && c.pausaRemota === 'lento') mostrarPausaRemota(c, 0);
    }, 500));
  }

  function comecarComoCliente(c, p) {
    var configuracao = p.configuracao;
    configuracao.vagas.forEach(function (v) { v.local = v.cid === c.cid; });
    // Chegou no meio da partida: assiste até a próxima (issue #9).
    c.espectador = !configuracao.vagas.some(function (v) { return v.cid === c.cid; });
    c.rodada = p.r;
    c.ultimoSeq = -1;
    var jogo = IT.jogo;
    jogo.rede = c;
    jogo.aoAvisar = null;
    jogo.aoFim = null;
    c.ultimaMensagemEm = Date.now();
    jogo.jogar(configuracao, { semIA: true });
    jogo.jogadores.forEach(function (j) { if (j.cid === c.cid) j.explorador.caminho = []; });
    IT.ui.modoEspectador(c.espectador);
    avisoSala('');
    if (!c.vigiando) { c.vigiando = true; vigiarAnfitriao(c); }
  }

  function foraDaPartida(c, rodada) {
    var jogo = IT.jogo;
    return jogo.rede !== c || (jogo.estado !== 'jogando' && jogo.estado !== 'fim') || c.rodada !== rodada;
  }

  /* ---------- Mensagens recebidas ---------- */

  function receber(c, evento, p) {
    var jogo = IT.jogo;

    // Mensagem de outro anfitrião: vale a eleição mais nova.
    if (p && p.a && c.sala && p.a !== c.sala.anfitriao) {
      if (!eleicaoMaisNova(c, p)) return;          // anfitrião antigo: ignora
      if (c.anfitriao && c.sala.turma && c.sala.estado === 'espera') virarConvidadaDaTurma(c, p);
      else if (c.anfitriao) virarCliente(c, p);    // eu era o anfitrião: agora não sou mais
      else {
        c.sala.anfitriao = p.a;
        c.sala.eleicao = p.e || 0;
        c.vistoAnfitriao = true;
      }
    }

    if (c.anfitriao) {
      if (evento === 'pedirSala') {
        enviar(c, 'sala', c.sala);
      } else if (evento === 'pedirCor') {
        var m = c.sala.membros.filter(function (x) { return x.cid === p.cid; })[0];
        if (m && IT.ORDEM_CORES.indexOf(p.cor) !== -1 && coresUsadas(c.sala, p.cid).indexOf(p.cor) === -1) {
          m.cor = p.cor;
          desenharSala();
        }
        enviar(c, 'sala', c.sala);
      } else if (evento === 'pedirNome') {
        var mn = c.sala.membros.filter(function (x) { return x.cid === p.cid; })[0];
        var novo = String(p.nome || '').trim().slice(0, 12);
        if (mn && novo) { mn.nome = novo; desenharSala(); }
        enviar(c, 'sala', c.sala);
      } else if (evento === 'dir') {
        if (jogo.rede !== c || jogo.estado !== 'jogando') return;
        jogo.jogadores.forEach(function (j) {
          if (j.cid === p.cid && j.tipo === 'humano' && DIRS[p.d]) aplicarViradaRemota(c, j, DIRS[p.d], p);
        });
      } else if (evento === 'pedirSnap') {
        if (jogo.rede === c && jogo.estado === 'jogando') enviarSnapshot(c);
      } else if (evento === 'pedirEstado') {
        enviar(c, 'sala', c.sala);
        enviarEstadoCompleto(c, p.cid);
      } else if (evento === 'revanche') {
        registrarVoto(c, p.cid);
      } else if (evento === 'tchau') {
        var saiu = c.sala.membros.filter(function (x) { return x.cid === p.cid; })[0];
        if (saiu) {
          var emJogo = jogo.rede === c && jogo.estado === 'jogando';
          if (emJogo) jogo.jogadores.forEach(function (j) {
            if (j.cid === saiu.cid && j.tipo === 'humano') jogo.transformarEmCPU(j, O.NIVEL_DE_QUEM_SAI);
          });
          c.sala.membros = c.sala.membros.filter(function (x) { return x !== saiu; });
          c.sala.cpus = Math.min(c.sala.cpus, IT.config.MAX_JOGADORES - c.sala.membros.length);
          var texto = saiu.nome + ' saiu da sala' + (emJogo ? '. A CPU continua no lugar! 🤖' : '. 👋');
          IT.ui.mostrarMensagem(texto, 'aviso');
          enviar(c, 'msg', { texto: texto, tipo: 'aviso', id: 0 });
          if (jogo.estado === 'fim' && jogo.rede === c && c.votos) registrarVoto(c, '-');
          enviar(c, 'sala', c.sala);
          desenharSala();
          salvarSessao(c);
        }
      }
      return;
    }

    // Cliente.
    if (evento === 'tchau') {
      if (c.sala && p.cid === c.sala.anfitriao) eleger(c);
      return;
    }
    if (evento === 'sala') {
      c.ultimaSalaEm = Date.now(); // "sinal de vida" do anfitrião fora da partida
      var primeira = !c.sala;
      c.sala = p;
      if (p.turma) {
        // Turma: guarda no aparelho (com o nome que a anfitriã usa) e deixa de "procurar".
        c.turma = p.turma;
        if (primeira) IT.turma.lembrar(p.turma.id, p.turma.nome);
        if (c.presenca && c.presenca.procurando) rastrear(c, { nome: c.nome, cor: c.presenca.cor, papel: 'jogador' });
      }
      c.vistoAnfitriao = c.vistoAnfitriao || !!c.canal.presenceState()[p.anfitriao];
      if (primeira) {
        ocupado(false);
        avisoOnline('');
        if (!p.membros.some(function (x) { return x.cid === c.cid; }) && p.membros.length >= IT.config.MAX_JOGADORES) {
          sair('');
          jogo.irPara('online');
          avisoOnline('Essa sala já está cheia (4 jogadores). 🙈');
          return;
        }
        if (c.voltando) { avisoSala('Você voltou para a sala! 🎉'); c.voltando = false; }
        jogo.irPara('sala');
      }
      // Partida em andamento e eu ainda não estou nela (cheguei no meio ou voltei):
      // peço o estado completo — quem não estava na partida assiste até a próxima.
      if ((p.estado === 'jogando' || p.estado === 'fim') && foraDaPartida(c, p.rodada) && !c.esperandoEstado) {
        // Espera um pouco: se o 'inicio' estiver a caminho, não precisa pedir nada.
        c.esperandoEstado = true;
        var rodada = p.rodada;
        c.timers.push(setTimeout(function () {
          c.esperandoEstado = false;
          if (con === c && foraDaPartida(c, rodada)) enviar(c, 'pedirEstado', { cid: c.cid });
        }, 1500));
      }
      salvarSessao(c);
      desenharSala();
    } else if (evento === 'cheia') {
      if (p.cid !== c.cid) return;
      sair('');
      jogo.irPara('online');
      avisoOnline('Essa sala já está cheia (4 jogadores). 🙈');
    } else if (evento === 'inicio') {
      if (!c.sala || !p.configuracao.vagas.some(function (v) { return v.cid === c.cid; })) return;
      comecarComoCliente(c, p);
    } else if (evento === 'estadoCompleto') {
      if (p.para !== c.cid) return;
      comecarComoCliente(c, { r: p.r, configuracao: p.configuracao });
      aplicarEstado(c, { r: p.r, s: p.s, t: p.t, j: p.j, d: p.d, k: p.k }, true);
      aplicarJogadores(p.j);
      jogo.tempoRestante = p.t;
      IT.ui.atualizarHUD(jogo);
      if (p.estadoJogo === 'fim' && p.ranking) jogo.mostrarFimRemoto(p.ranking, false);
      // Quem recarregou a página como anfitrião volta a ser um jogador comum.
      if (c.presenca && c.presenca.semEstado) {
        rastrear(c, { nome: c.nome, cor: c.presenca.cor, papel: 'jogador' });
      }
    } else if (evento === 'estado') {
      aplicarEstado(c, p, false);
    } else if (evento === 'snap') {
      aplicarEstado(c, p, true);
    } else if (evento === 'msg') {
      if (jogo.rede !== c) return;
      var j = p.id ? jogo.jogadorPorId(p.id) : null;
      IT.ui.mostrarMensagem(p.texto, p.tipo, j ? j.cor.escura : null);
      jogo.efeitosPara(j, p.tipo, p.de ? jogo.jogadorPorId(p.de) : null);
    } else if (evento === 'pausa') {
      if (jogo.rede === c) { c.ultimaMensagemEm = Date.now(); mostrarPausaRemota(c, p.motivo || 'menu'); }
    } else if (evento === 'retomar') {
      if (jogo.rede === c) { c.ultimaMensagemEm = Date.now(); mostrarPausaRemota(c, 0); }
    } else if (evento === 'fim') {
      if (jogo.rede !== c || p.r !== c.rodada || jogo.estado !== 'jogando') return;
      jogo.mostrarFimRemoto(p.ranking, p.porTempo);
    } else if (evento === 'votos') {
      if (jogo.rede === c && jogo.estado === 'fim') {
        IT.ui.mostrarVotosRevanche(p.nomes, p.total, p.cids.indexOf(c.cid) !== -1);
      }
    } else if (evento === 'voltarSala') {
      IT.ui.avisoRede('');
      IT.ui.modoEspectador(false);
      c.espectador = false;
      jogo.rede = null;
      jogo.irPara('sala');
      desenharSala();
    }
  }

  /* ---------- Convite por link ---------- */

  function linkDaSala(codigo) {
    return location.origin + location.pathname.replace(/index\.html$/, '') + '?sala=' + codigo.split('-')[1];
  }

  /* Link desta sala: o fixo da turma, ou o ?sala= da sala avulsa. */
  function linkDoConvite(sala) {
    return sala.turma ? IT.turma.link(sala.turma.id) : linkDaSala(sala.codigo);
  }

  /* Compartilha o link (celular) ou copia (computador). */
  function convidar() {
    var c = con;
    if (!c || !c.sala) return;
    var turma = c.sala.turma;
    var link = linkDoConvite(c.sala);
    var texto = turma
      ? 'Vem pintar a ilha com a turma ' + turma.nome + '! 🎨 É só tocar no link para entrar (vale sempre):'
      : 'Vem pintar a ilha comigo! 🎨 Sala ' + c.sala.codigo;
    if (navigator.share) {
      navigator.share({ title: 'Ilhas de Tinta', text: texto, url: link }).catch(function () { /* cancelou */ });
      return;
    }
    var copiar = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(turma ? texto + ' ' + link : link) : Promise.reject();
    copiar.then(function () {
      avisoSala(turma ? 'Link da turma copiado! Cole no WhatsApp dos amigos 😊' : 'Link copiado! Mande para seus amigos 😊');
    }, function () {
      avisoSala('Mande este link para ' + 'seus amigos' + ': ' + link);
    });
  }

  /* QR grande do link, para os amigos lerem com a câmera. */
  function mostrarQR() {
    var c = con;
    if (!c || !c.sala) return;
    var link = linkDoConvite(c.sala);
    el.telaQr.hidden = false;
    el.qrTitulo.textContent = c.sala.turma ? 'Turma ' + c.sala.turma.nome + ': aponte a câmera 📱' : 'Aponte a câmera 📱';
    var lado = Math.max(180, Math.min(320, window.innerWidth - 90, window.innerHeight - 260));
    IT.turma.desenharQR(el.qrCanvas, link, lado);
    el.qrLink.textContent = link;
    el.qrFechar.focus();
  }

  /* ---------- Trocar o nome (na sala de espera) ---------- */

  function abrirTrocarNome() {
    if (!con) return;
    el.salaFormNome.hidden = false;
    el.salaTrocarNome.hidden = true;
    el.salaNovoNome.value = con.nome;
    el.salaNovoNome.focus();
    el.salaNovoNome.select();
  }

  function salvarNovoNome() {
    var c = con;
    el.salaFormNome.hidden = true;
    el.salaTrocarNome.hidden = false;
    var novo = el.salaNovoNome.value.trim().slice(0, 12);
    if (!c || !c.sala || !novo || novo === c.nome) return;
    IT.turma.salvarNome(novo);
    el.nome.value = novo;
    c.nome = novo;
    rastrear(c, { nome: novo, cor: c.presenca ? c.presenca.cor : null, papel: c.anfitriao ? 'anfitriao' : 'jogador', chegou: c.presenca ? c.presenca.chegou : undefined });
    var eu = c.sala.membros.filter(function (m) { return m.cid === c.cid; })[0];
    if (c.anfitriao) {
      if (eu) eu.nome = novo;
      enviar(c, 'sala', c.sala);
    } else {
      if (eu) eu.nome = novo; // aparece já; o anfitrião confirma
      enviar(c, 'pedirNome', { cid: c.cid, nome: novo });
    }
    salvarSessao(c);
    desenharSala();
  }

  /* ---------- Tela "Jogar Online": turmas salvas, convite, criar turma ---------- */

  var convitePendente = null;   // turma aberta por link, esperando o nome
  var codigoAberto = false;     // "Tenho um código" tocado (quando CODIGO_NO_MENU = false)

  function desenharOnline() {
    var turmas = IT.turma.lista();
    el.listaTurmas.innerHTML = '';
    turmas.forEach(function (t) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.className = 'botao botao-turma';
      b.textContent = '👭 Jogar com a turma ' + t.nome;
      b.addEventListener('click', function () { entrarNaTurma(t.id, t.nome); });
      var x = document.createElement('button');
      x.className = 'botao-remover';
      x.textContent = '✕';
      x.title = 'Tirar a turma ' + t.nome + ' da lista';
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', function () {
        if (window.confirm('Tirar a turma ' + t.nome + ' da lista deste aparelho? (O link da turma continua valendo.)')) {
          IT.turma.esquecer(t.id);
          desenharOnline();
        }
      });
      li.appendChild(b);
      li.appendChild(x);
      el.listaTurmas.appendChild(li);
    });
    el.turmas.hidden = !turmas.length || !!convitePendente;
    el.convite.hidden = !convitePendente;
    el.entrarConvite.hidden = !convitePendente;
    el.criarBloco.hidden = !!convitePendente;
    var codigoVisivel = O.CODIGO_NO_MENU || codigoAberto;
    el.codigoBloco.hidden = !!convitePendente || !codigoVisivel;
    el.tenhoCodigo.hidden = !!convitePendente || codigoVisivel;
    if (convitePendente) {
      el.convite.textContent = 'Você foi chamado para a turma ' + convitePendente.nome + '! 👭 Escreva seu nome e toque em Entrar.';
      el.entrarConvite.textContent = '🚪 Entrar na turma ' + convitePendente.nome;
    }
  }

  function criarTurma() {
    var nomeTurma = el.turmaNome.value.trim().slice(0, 16);
    if (!nomeTurma) { avisoOnline('Escolha um nome para a turma 🙂'); el.turmaNome.focus(); return; }
    entrarNaTurma(IT.turma.criarId(nomeTurma), nomeTurma);
  }

  /* ---------- API usada pelo game.js e pela interface ---------- */

  IT.online = {
    iniciar: function () {
      el.nome = $('online-nome');
      el.codigo = $('online-codigo');
      el.criar = $('online-criar');
      el.entrar = $('online-entrar');
      el.aviso = $('online-aviso');
      el.menuAviso = $('menu-aviso');
      el.salaCodigo = $('sala-codigo');
      el.salaDica = $('sala-dica');
      el.salaJogadores = $('sala-jogadores');
      el.salaCores = $('sala-cores');
      el.salaAnfitriao = $('sala-anfitriao');
      el.salaCpus = $('sala-cpus');
      el.salaNivel = $('sala-nivel');
      el.salaLinhaNivel = $('sala-linha-nivel');
      el.salaAviso = $('sala-aviso');
      el.salaRotulo = $('sala-rotulo');
      el.salaConvidar = $('sala-convidar');
      el.salaMeuNome = $('sala-meu-nome');
      el.salaTrocarNome = $('sala-trocar-nome');
      el.salaFormNome = $('sala-form-nome');
      el.salaNovoNome = $('sala-novo-nome');
      el.convite = $('online-convite');
      el.turmas = $('online-turmas');
      el.listaTurmas = $('online-lista-turmas');
      el.entrarConvite = $('online-entrar-convite');
      el.criarBloco = $('online-criar-bloco');
      el.novaTurma = $('online-nova-turma');
      el.turmaNome = $('online-turma-nome');
      el.confirmarTurma = $('online-turma-confirmar');
      el.codigoBloco = $('online-codigo-bloco');
      el.tenhoCodigo = $('online-tenho-codigo');
      el.telaQr = $('tela-qr');
      el.qrCanvas = $('qr-canvas');
      el.qrTitulo = $('qr-titulo');
      el.qrLink = $('qr-link');
      el.qrFechar = $('qr-fechar');

      el.nome.value = IT.turma.nome(); // nome lembrado neste aparelho

      $('online-criar-turma').addEventListener('click', function () {
        el.novaTurma.hidden = !el.novaTurma.hidden;
        if (!el.novaTurma.hidden) el.turmaNome.focus();
      });
      el.confirmarTurma.addEventListener('click', criarTurma);
      el.turmaNome.addEventListener('keydown', function (e) { if (e.key === 'Enter') criarTurma(); });
      el.entrarConvite.addEventListener('click', function () {
        if (convitePendente) entrarNaTurma(convitePendente.id, convitePendente.nome);
      });
      el.nome.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && convitePendente) entrarNaTurma(convitePendente.id, convitePendente.nome);
      });
      el.tenhoCodigo.addEventListener('click', function () { codigoAberto = true; desenharOnline(); el.codigo.focus(); });
      $('sala-qr').addEventListener('click', mostrarQR);
      el.qrFechar.addEventListener('click', function () { el.telaQr.hidden = true; });
      el.salaTrocarNome.addEventListener('click', abrirTrocarNome);
      $('sala-salvar-nome').addEventListener('click', salvarNovoNome);
      el.salaNovoNome.addEventListener('keydown', function (e) { if (e.key === 'Enter') salvarNovoNome(); });

      el.criar.addEventListener('click', criarSala);
      el.entrar.addEventListener('click', entrarNaSala);
      el.codigo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrarNaSala(); });
      $('online-voltar').addEventListener('click', function () { avisoOnline(''); IT.jogo.irPara('menu'); });
      $('sala-jogar').addEventListener('click', comecarPartida);
      $('sala-sair').addEventListener('click', function () { sair(''); });
      $('sala-convidar').addEventListener('click', convidar);
      window.addEventListener('beforeunload', function () { fechar(con); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !con) return;
        if (con.esperandoVoltar) voltarComoJogador(con);
        if (!con.inscrito && con.jaConectou) reabrir(con); else checarSaude(con);
      });
      // Voltou a internet, ou a página voltou do "congelamento" (resume): confere a
      // conexão e reconecta se precisar.
      ['online', 'pageshow'].forEach(function (evento) {
        window.addEventListener(evento, function () {
          if (!con) return;
          if (!con.inscrito && con.jaConectou) reabrir(con); else checarSaude(con);
        });
      });
      document.addEventListener('resume', function () { if (con) checarSaude(con); });
      // O navegador avisou que a internet caiu: mostra "Reconectando…" na hora
      // (o WebSocket às vezes demora para perceber sozinho).
      window.addEventListener('offline', function () {
        if (!con || !con.jaConectou) return;
        con.inscrito = false;
        if (!con.caiuEm) con.caiuEm = Date.now();
        mostrarReconectando(con, true);
      });
    },

    /* Botão "Jogar Online" do menu. */
    abrir: function () {
      var motivo = motivoIndisponivel();
      if (motivo) { avisoMenu(motivo); return; }
      avisoMenu('');
      avisoOnline('');
      el.aviso.classList.remove('aviso-convite');
      convitePendente = null;
      codigoAberto = false;
      el.novaTurma.hidden = true;
      ocupado(false);
      IT.jogo.irPara('online');
      desenharOnline();
      // Foco: a primeira turma salva (um toque e entra) ou "Criar sala".
      var primeira = el.listaTurmas.querySelector('.botao-turma');
      if (primeira) primeira.focus(); else if (el.nome.value) el.criar.focus();
    },

    /* Abriu o jogo por um link de convite (?sala=4821): já deixa o código pronto. */
    abrirConvite: function (numeros) {
      var codigo = normalizarCodigo(numeros);
      if (!codigo) return;
      IT.online.abrir();
      if (IT.jogo.estado !== 'online') return; // sem internet/arquivo: o menu já mostrou o aviso
      el.codigo.value = codigo.split('-')[1];
      codigoAberto = true;
      desenharOnline();
      // Nome lembrado neste aparelho: entra direto, sem pedir nada.
      if (IT.turma.nome()) { entrarNaSala(); return; }
      avisoOnline('Você foi convidado para a sala ' + codigo + '! 🎉 Escreva seu nome e toque em Entrar.');
      el.aviso.classList.add('aviso-convite');
      el.nome.focus();
    },

    /*
     * Abriu o link da turma (?turma=gatinhas-k7m2x). Com o nome lembrado, entra
     * direto; sem nome, pede só o nome (um campo e um botão).
     */
    abrirTurma: function (id) {
      id = String(id || '').toLowerCase();
      if (!IT.turma.valido(id)) { IT.online.abrir(); avisoOnline('Esse link de turma não está completo. 🤔 Peça o link de novo para quem criou.'); return; }
      // Recarregou a página no meio da turma: retomarSessao cuida (mesma identidade).
      var sessao = lerSessao();
      if (sessao && sessao.codigo === codigoDaTurma(id)) return;
      if (sessao) limparSessao();
      IT.online.abrir();
      if (IT.jogo.estado !== 'online') return; // sem internet/arquivo: o menu já mostrou o aviso
      var nomeTurma = IT.turma.nomeDe(id);
      if (IT.turma.nome()) { entrarNaTurma(id, nomeTurma); return; }
      convitePendente = { id: id, nome: nomeTurma };
      desenharOnline();
      el.nome.focus();
    },

    entrarNaTurma: entrarNaTurma,
    linkDoConvite: function () { return con && con.sala ? linkDoConvite(con.sala) : null; },

    linkDaSala: linkDaSala,

    /*
     * Página recarregada (ou reaberta) durante uma sala: volta para ela com a
     * mesma identidade. Se ninguém responder e eu era o anfitrião da sala de
     * espera, a sala continua comigo.
     */
    retomarSessao: function () {
      var sessao = lerSessao();
      if (!sessao || con || motivoIndisponivel()) return false;
      IT.online.abrir();
      avisoOnline('Voltando para a sala ' + sessao.codigo + '… 🔄');
      ocupado(true);
      conectar(sessao.codigo, false, sessao.nome, sessao.cid).then(function (c) {
        con = c;
        c.turma = sessao.turma || null;
        c.voltando = true;
        // semEstado: eu era o anfitrião e perdi o jogo ao recarregar → outro assume.
        return rastrear(c, { nome: sessao.nome, cor: null, papel: 'jogador', semEstado: !!sessao.anfitriao }).then(function () {
          enviar(c, 'pedirSala', { cid: c.cid });
          c.timers.push(setTimeout(function () { if (con === c && !c.sala) enviar(c, 'pedirSala', { cid: c.cid }); }, 1500));
          c.timers.push(setTimeout(function () {
            if (con !== c || c.sala) return;
            if (sessao.anfitriao && sessao.sala) {
              // Ninguém mais na sala: continuo sendo o anfitrião (sala de espera).
              c.anfitriao = true;
              c.sala = sessao.sala;
              c.sala.estado = 'espera';
              c.sala.anfitriao = c.cid;
              rastrear(c, { nome: sessao.nome, cor: 'rosa', papel: 'anfitriao' });
              ocupado(false);
              avisoOnline('');
              IT.jogo.irPara('sala');
              transmitir(c);
              presencaMudou(c);
              desenharSala();
              avisoSala('Você voltou para a sua sala! 🎉');
              salvarSessao(c);
            } else if (sessao.turma) {
              // Turma: ninguém respondeu → entra de novo (e vira a anfitriã se estiver vazia).
              sair('');
              IT.jogo.irPara('online');
              ocupado(false);
              entrarNaTurma(sessao.turma.id, sessao.turma.nome);
            } else {
              sair('');
              IT.jogo.irPara('online');
              ocupado(false);
              avisoOnline('A sala ' + sessao.codigo + ' acabou. Que tal criar uma nova? 🙂');
            }
          }, O.TEMPO_PROCURAR_SALA * 1000));
        });
      }).catch(function () {
        ocupado(false);
        avisoOnline('Não consegui voltar para a sala agora. 😕 Tente entrar de novo.');
      });
      return true;
    },

    /* Usado nos testes e nas medições (issues #5 e #7). */
    conexao: function () { return con; },
    contagem: function () { return contagem; },
    zerarContagem: function () {
      contagem = { enviadas: {}, recebidas: {}, bytesEnviados: 0, bytesRecebidos: 0, desde: Date.now() };
      medidasVirada = { pedidas: 0, mostradaNaHoraMs: [], anfitriaoConfirmouMs: [], correcoes: 0, mantidas: 0 };
      estatViradas = { exatas: 0, rebobinadas: 0, atrasadas: 0, agendadas: 0, antigoAtrasaria: 0 };
    },
    medidasVirada: function () { return { cliente: medidasVirada, anfitriao: estatViradas }; },
    sair: sair
  };

  /* Mede quanto tempo a virada leva para aparecer na tela deste aparelho. */
  function medirViradaLocal(e, d, inicio) {
    var limite = inicio + 2000;
    (function checar() {
      if (e.direcao === d) { medidasVirada.mostradaNaHoraMs.push(Date.now() - inicio); return; }
      if (Date.now() < limite) requestAnimationFrame(checar);
    })();
  }

  /* Métodos que o game.js chama em jogo.rede (a conexão da sala). */
  /* ---------- Previsão do MEU rastro (cliente) ---------- */

  /*
   * Sem isto, o meu explorador (que anda na hora, por previsão) ficava várias
   * células à frente do próprio rastro — o rastro só aparecia quando o estado do
   * anfitrião chegava ("o personagem sai correndo"). Agora o rastro é pintado
   * aqui na hora; o anfitrião confirma (manda a mesma célula) ou desfaz.
   * c.previstos[índice] = { antes: valor do anfitrião, quando }.
   */
  function preverChegada(c, j, x, y) {
    var g = IT.jogo.grade, k = y * g.colunas + x;
    if (c.espectador || g.donos[k] === j.id || g.rastros[k] === j.id) return true;
    c.previstos = c.previstos || {};
    if (!(k in c.previstos)) c.previstos[k] = { antes: g.rastros[k], quando: Date.now() };
    g.rastros[k] = j.id;
    return true;
  }

  /* Depois de aplicar o que o anfitrião mandou: mantém só o rastro previsto ainda não confirmado. */
  function conferirPrevistos(c, tocadas) {
    if (!c.previstos) return;
    var g = IT.jogo.grade, meu = meuJogador(c), agora = Date.now();
    if (!meu) { c.previstos = null; return; }
    var validade = Math.max(c.atrasoMs || 400, 250) * 1.5 + 600;
    Object.keys(c.previstos).forEach(function (chave) {
      var k = +chave, pv = c.previstos[k];
      var doAnfitriao = g.rastros[k];
      if (tocadas && !tocadas[k] && doAnfitriao === meu.id) doAnfitriao = pv.antes; // ainda é a minha previsão
      if (doAnfitriao === meu.id || g.donos[k] === meu.id) { delete c.previstos[k]; return; } // confirmado
      if (doAnfitriao !== 0 || agora - pv.quando > validade) { // o anfitrião discorda, ou demorou demais
        g.rastros[k] = doAnfitriao;
        delete c.previstos[k];
        return;
      }
      pv.antes = doAnfitriao;
      g.rastros[k] = meu.id; // ainda não chegou no anfitrião: continua previsto
    });
  }

  /* Previsão errada (correção): o rastro previsto volta a ser o do anfitrião. */
  function desfazerPrevistos(c) {
    if (!c.previstos) return;
    var g = IT.jogo.grade, meu = meuJogador(c);
    Object.keys(c.previstos).forEach(function (chave) {
      var k = +chave;
      if (meu && g.rastros[k] === meu.id) g.rastros[k] = c.previstos[k].antes;
    });
    c.previstos = null;
  }

  function meuJogador(c) {
    return IT.jogo.jogadores.filter(function (j) { return j.cid === c.cid && j.tipo === 'humano'; })[0];
  }

  var MetodosRede = {
    preverChegada: function (j, x, y) { return preverChegada(this, j, x, y); },
    direcionar: function (direcao) {
      var c = this;
      var meu = IT.jogo.jogadores.filter(function (j) { return j.cid === c.cid && j.tipo === 'humano'; })[0];
      if (!meu) return false;
      if (c.anfitriao) return meu.explorador.pedirDirecao(direcao);
      // Cliente: meia-volta é recusada aqui mesmo (o anfitrião também recusaria).
      var e = meu.explorador;
      if (e.direcao && IT.OPOSTA[e.direcao] === direcao) return false;
      if (e.direcao === direcao && !e.proximaDirecao) return false; // nada muda: não gasta mensagem
      // Onde a virada acontece: na próxima célula em que eu chego (ou aqui, se parado).
      var x = e.direcao ? e.alvoX : e.x, y = e.direcao ? e.alvoY : e.y;
      c.entradas = (c.entradas || 0) + 1;
      enviar(c, 'dir', { cid: c.cid, d: DIRS.indexOf(direcao), x: x, y: y, n: c.entradas });
      // Previsão (issue #7): mostra a virada aqui na hora, sem esperar o anfitrião.
      e.pedirDirecao(direcao);
      c.viradaPendente = { n: c.entradas, d: direcao, quando: Date.now() };
      medidasVirada.pedidas++;
      medirViradaLocal(e, direcao, Date.now());
      return true;
    },
    pausar: function (motivo) {
      this.motivoPausa = motivo;
      enviar(this, 'pausa', { motivo: motivo });
    },
    retomar: function () {
      this.motivoPausa = 0;
      enviar(this, 'retomar', {});
    },
    /* "🔁 Revanche": vota. Quando todos os humanos votam, o anfitrião começa outra. */
    jogarDeNovo: function () {
      var c = this;
      if (c.anfitriao) registrarVoto(c, c.cid);
      else {
        enviar(c, 'revanche', { cid: c.cid });
        IT.ui.mostrarVotosRevanche([c.nome + ' (você)'], humanosDaPartida(c).length || 1, true);
      }
    },
    mudarJogadores: function () {
      var c = this;
      if (!c.anfitriao) { sair(''); return; }
      c.sala.estado = 'espera';
      enviar(c, 'voltarSala', {});
      enviar(c, 'sala', c.sala);
      IT.jogo.rede = null;
      IT.jogo.aoAvisar = null;
      IT.jogo.aoFim = null;
      IT.jogo.irPara('sala');
      desenharSala();
      c.timers.forEach(function (t) { clearInterval(t); });
      c.timers = [setInterval(function () { if (c.sala.estado === 'espera') enviar(c, 'sala', c.sala); }, 3000)];
    }
  };

})(window.IlhasDeTinta);

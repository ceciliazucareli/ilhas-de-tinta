/*
 * online.js — partidas online pelo Supabase Realtime (só Broadcast + Presence).
 *
 * Não há servidor do jogo nem banco de dados: o navegador de quem CRIA a sala é
 * o "anfitrião" e roda a simulação de verdade (o mesmo código do modo offline,
 * inclusive as CPUs). O Supabase só repassa mensagens entre os aparelhos.
 *
 *   anfitrião ──(10x/s: posições + células que mudaram; foto completa a cada 3 s)──▶ clientes
 *   clientes  ──(só quando apertam uma tecla: nova direção)──────────────────────────▶ anfitrião
 *
 * Presence mostra quem está na sala. Se o anfitrião sai, os outros voltam ao
 * menu com um aviso. Se um cliente sai no meio da partida, o explorador dele
 * passa a ser jogado pela CPU (nível em config.js) até a partida acabar.
 *
 * Mensagens (eventos de broadcast no canal "ilhas-de-tinta-<CÓDIGO>"):
 *   sala      anfitrião → todos   quem está na sala, cores, CPUs, estado
 *   pedirSala cliente → anfitrião  "acabei de entrar, me mande a sala"
 *   pedirCor  cliente → anfitrião  troca de cor
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
    try { if (nome) localStorage.setItem('ilhas-de-tinta:nome', nome); } catch (e) { /* sem armazenamento */ }
    return nome || 'Explorador';
  }

  function avisoOnline(texto) { el.aviso.textContent = texto || ''; }
  function avisoSala(texto) { el.salaAviso.textContent = texto || ''; }
  function avisoMenu(texto) { el.menuAviso.textContent = texto || ''; }

  function ocupado(sim) {
    el.criar.disabled = sim;
    el.entrar.disabled = sim;
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

  function enviar(c, evento, dados) {
    if (!c || c.fechada) return;
    if (c.anfitriao && dados && typeof dados === 'object' && c.sala) {
      dados.a = c.cid;                    // quem está mandando como anfitrião
      dados.e = c.sala.eleicao || 0;      // de qual "eleição" de anfitrião
    }
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
        sala: c.anfitriao ? c.sala : null, quando: Date.now()
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
    el.salaCodigo.textContent = sala.codigo;
    var eu = sala.membros.filter(function (m) { return m.cid === c.cid; })[0];

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
        ? 'Diga este código para seus amigos entrarem, ou coloque uma CPU para jogar com você!'
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
        c.sala = {
          codigo: codigo, anfitriao: c.cid,
          membros: [{ cid: c.cid, nome: nome, cor: 'rosa' }],
          cpus: 0, nivel: 'medio', estado: 'espera', rodada: 0
        };
        return rastrear(c, { nome: nome, cor: 'rosa', papel: 'anfitriao' })
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

    tentar().then(function (c) {
      ocupado(false);
      avisoOnline('');
      avisoSala('');
      salvarSessao(c);
      IT.jogo.irPara('sala');
      presencaMudou(c);
      desenharSala();
      // De tempos em tempos reenvia a sala (para quem chegou e perdeu alguma mensagem).
      c.timers.push(setInterval(function () { if (c.sala.estado !== 'jogando') enviar(c, 'sala', c.sala); }, 3000));
    }).catch(function (erro) {
      console.warn('Não foi possível criar a sala:', erro);
      ocupado(false);
      avisoOnline('Não consegui criar a sala agora. 😕 Confira a internet e tente de novo, ou jogue Offline.');
    });
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
      return rastrear(c, { nome: nome, cor: null, papel: 'jogador' }).then(function () {
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
    enviar(c, 'sala', c.sala);
    enviar(c, 'inicio', { r: c.rodada, configuracao: JSON.parse(JSON.stringify(configuracao)) });

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

  /* Anfitrião: manda o estado 10x/s (com foto completa de tempos em tempos). */
  function transmitir(c) {
    var jogo = IT.jogo;
    c.timers.forEach(function (t) { clearInterval(t); });
    c.timers = [];
    var envios = 0;
    var porSnapshot = Math.round(O.SNAPSHOT_A_CADA * O.ENVIOS_POR_SEGUNDO);
    c.timers.push(setInterval(function () {
      if (jogo.rede !== c || jogo.estado !== 'jogando') return;
      envios++;
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
        e.direcao ? DIRS.indexOf(e.direcao) : -1, DIRS.indexOf(e.ultimaDirecao), j.cacando ? 1 : 0];
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

  function aplicarJogadores(lista) {
    var jogadores = IT.jogo.jogadores;
    lista.forEach(function (p, i) {
      var e = jogadores[i] && jogadores[i].explorador;
      if (!e) return;
      e.x = p[0]; e.y = p[1]; e.alvoX = p[2]; e.alvoY = p[3];
      e.progresso = p[4] / 100;
      e.direcao = p[5] >= 0 ? DIRS[p[5]] : null;
      e.ultimaDirecao = DIRS[p[6]] || e.ultimaDirecao;
      jogadores[i].cacando = !!p[7]; // Impossível 😈 caçando (mostra o aviso)
    });
  }

  function aplicarEstado(c, p, foto) {
    var jogo = IT.jogo;
    if (jogo.rede !== c || p.r !== c.rodada || (jogo.estado !== 'jogando' && jogo.estado !== 'fim')) return;
    var g = jogo.grade;
    if (foto) {
      for (var i = 0; i < g.total; i++) {
        g.donos[i] = p.d.charCodeAt(i) - 48;
        g.rastros[i] = p.k.charCodeAt(i) - 48;
      }
    } else {
      for (var k = 0; k < p.c.length; k += 3) {
        g.donos[p.c[k]] = p.c[k + 1];
        g.rastros[p.c[k]] = p.c[k + 2];
      }
      // Pulou mensagens? Pede uma foto completa (no máximo a cada 2 s).
      if (c.ultimoSeq >= 0 && p.s > c.ultimoSeq + 1 && Date.now() - c.ultimoPedidoSnap > 2000) {
        c.ultimoPedidoSnap = Date.now();
        enviar(c, 'pedirSnap', { cid: c.cid });
      }
    }
    c.ultimoSeq = Math.max(c.ultimoSeq, p.s);
    c.ultimaMensagemEm = Date.now();
    if (!foto) mostrarPausaRemota(c, p.pa || 0);
    if (jogo.estado === 'jogando') {
      aplicarJogadores(p.j);
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
    IT.ui.modoEspectador(c.espectador);
    avisoSala('');
    if (!c.vigiando) { c.vigiando = true; vigiarAnfitriao(c); }
  }

  /* ---------- Mensagens recebidas ---------- */

  function receber(c, evento, p) {
    var jogo = IT.jogo;

    // Mensagem de outro anfitrião: vale a eleição mais nova.
    if (p && p.a && c.sala && p.a !== c.sala.anfitriao) {
      if (!eleicaoMaisNova(c, p)) return;          // anfitrião antigo: ignora
      if (c.anfitriao) virarCliente(c, p);         // eu era o anfitrião: agora não sou mais
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
      } else if (evento === 'dir') {
        if (jogo.rede !== c || jogo.estado !== 'jogando') return;
        jogo.jogadores.forEach(function (j) {
          if (j.cid === p.cid && j.tipo === 'humano' && DIRS[p.d]) j.explorador.pedirDirecao(DIRS[p.d]);
        });
      } else if (evento === 'pedirSnap') {
        if (jogo.rede === c && jogo.estado === 'jogando') enviarSnapshot(c);
      } else if (evento === 'pedirEstado') {
        enviar(c, 'sala', c.sala);
        enviarEstadoCompleto(c, p.cid);
      } else if (evento === 'revanche') {
        registrarVoto(c, p.cid);
      }
      return;
    }

    // Cliente.
    if (evento === 'sala') {
      c.ultimaSalaEm = Date.now(); // "sinal de vida" do anfitrião fora da partida
      var primeira = !c.sala;
      c.sala = p;
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
      var foraDoJogo = jogo.rede !== c || (jogo.estado !== 'jogando' && jogo.estado !== 'fim') || c.rodada !== p.rodada;
      if ((p.estado === 'jogando' || p.estado === 'fim') && foraDoJogo && Date.now() - (c.pediuEstadoEm || 0) > 2000) {
        c.pediuEstadoEm = Date.now();
        enviar(c, 'pedirEstado', { cid: c.cid });
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

  /* Compartilha o link (celular) ou copia (computador). */
  function convidar() {
    var c = con;
    if (!c || !c.sala) return;
    var link = linkDaSala(c.sala.codigo);
    var texto = 'Vem pintar a ilha comigo! 🎨 Sala ' + c.sala.codigo;
    if (navigator.share) {
      navigator.share({ title: 'Ilhas de Tinta', text: texto, url: link }).catch(function () { /* cancelou */ });
      return;
    }
    var copiar = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(link) : Promise.reject();
    copiar.then(function () {
      avisoSala('Link copiado! Mande para seus amigos 😊');
    }, function () {
      avisoSala('Mande este link para seus amigos: ' + link);
    });
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

      try { el.nome.value = localStorage.getItem('ilhas-de-tinta:nome') || ''; } catch (e) { /* sem armazenamento */ }

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
      ocupado(false);
      IT.jogo.irPara('online');
    },

    /* Abriu o jogo por um link de convite (?sala=4821): já deixa o código pronto. */
    abrirConvite: function (numeros) {
      var codigo = normalizarCodigo(numeros);
      if (!codigo) return;
      IT.online.abrir();
      if (IT.jogo.estado !== 'online') return; // sem internet/arquivo: o menu já mostrou o aviso
      el.codigo.value = codigo.split('-')[1];
      avisoOnline('Você foi convidado para a sala ' + codigo + '! 🎉 Escreva seu nome e toque em Entrar.');
      el.aviso.classList.add('aviso-convite');
    },

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

    /* Usado nos testes. */
    conexao: function () { return con; },
    sair: sair
  };

  /* Métodos que o game.js chama em jogo.rede (a conexão da sala). */
  var MetodosRede = {
    direcionar: function (direcao) {
      var c = this;
      var meu = IT.jogo.jogadores.filter(function (j) { return j.cid === c.cid && j.tipo === 'humano'; })[0];
      if (!meu) return false;
      if (c.anfitriao) return meu.explorador.pedirDirecao(direcao);
      // Cliente: meia-volta é recusada aqui mesmo (o anfitrião também recusaria).
      var e = meu.explorador;
      if (e.direcao && IT.OPOSTA[e.direcao] === direcao) return false;
      enviar(c, 'dir', { cid: c.cid, d: DIRS.indexOf(direcao) });
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

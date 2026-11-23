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
 *   pausa     anfitrião → todos   partida pausada (motivo: 'menu' ou 'fora' = saiu da tela)
 *   retomar   anfitrião → todos   partida continua
 *
 * Se o anfitrião sai da tela (bloqueou o celular, trocou de app), a partida
 * PAUSA e os outros veem "O anfitrião saiu da tela, esperando…". Se nenhuma
 * mensagem chega por alguns segundos, os outros veem "Esperando o anfitrião…".
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
        realtime: { params: { eventsPerSecond: 40 } }
      });
    }
    return supa;
  }

  /* Entra no canal da sala; resolve quando estiver conectado. */
  function conectar(codigo, anfitriao, nome) {
    var c = {
      codigo: codigo,
      cid: gerarId(),
      nome: nome,
      anfitriao: anfitriao,
      canal: null,
      sala: null,            // estado da sala (o anfitrião é o dono da verdade)
      rodada: 0,
      seq: 0,
      ultimoSeq: -1,
      vistoAnfitriao: false,
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
    var canal = clienteSupabase().channel('ilhas-de-tinta-' + codigo, {
      config: { broadcast: { self: false }, presence: { key: c.cid } }
    });
    c.canal = canal;

    canal.on('broadcast', { event: '*' }, function (m) {
      if (c.fechada || con !== c) return;
      try { receber(c, m.event, m.payload || {}); } catch (erro) { console.error('Mensagem online com problema:', erro); }
    });
    canal.on('presence', { event: 'sync' }, function () {
      if (c.fechada || con !== c) return;
      presencaMudou(c);
    });

    return new Promise(function (resolver, rejeitar) {
      var pronto = false;
      var relogio = setTimeout(function () {
        if (!pronto) { pronto = true; rejeitar(new Error('tempo esgotado')); }
      }, O.TEMPO_CONEXAO * 1000);
      canal.subscribe(function (status, erro) {
        if (status === 'SUBSCRIBED' && !pronto) {
          pronto = true;
          clearTimeout(relogio);
          resolver(c);
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') && !pronto) {
          pronto = true;
          clearTimeout(relogio);
          rejeitar(erro || new Error(status));
        } else if (pronto && status !== 'SUBSCRIBED' && !c.fechada && con === c) {
          // Caiu depois de conectado.
          conexaoCaiu(c);
        }
      });
    });
  }

  function enviar(c, evento, dados) {
    if (!c || c.fechada) return;
    c.canal.send({ type: 'broadcast', event: evento, payload: dados }).catch(function (erro) {
      console.warn('Falha ao enviar', evento, erro);
    });
  }

  function fechar(c) {
    if (!c || c.fechada) return;
    c.fechada = true;
    c.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    try { supa.removeChannel(c.canal); } catch (e) { /* já fechado */ }
  }

  /* Sai da sala e volta ao menu (com uma mensagem opcional). */
  function sair(mensagem) {
    var c = con;
    con = null;
    fechar(c);
    IT.ui.avisoRede('');
    var jogo = IT.jogo;
    jogo.rede = null;
    jogo.aoAvisar = null;
    jogo.aoFim = null;
    IT.ui.esconderMensagem();
    jogo.irPara('menu');
    avisoMenu(mensagem || '');
  }

  function conexaoCaiu(c) {
    sair('A conexão com a internet caiu. 😕 Tente de novo daqui a pouco.');
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
    var estado = c.canal.presenceState();
    var presentes = {};
    Object.keys(estado).forEach(function (chave) { presentes[chave] = (estado[chave] || [])[0] || {}; });

    if (!c.anfitriao) {
      // Cliente: só precisa saber se o anfitrião continua aqui.
      if (c.sala && presentes[c.sala.anfitriao]) c.vistoAnfitriao = true;
      if (c.sala && c.vistoAnfitriao && !presentes[c.sala.anfitriao]) {
        sair('O anfitrião saiu da sala. 👋 Que tal criar uma sala nova?');
      }
      return;
    }

    var sala = c.sala, mudou = false;
    // Quem saiu.
    sala.membros = sala.membros.filter(function (m) {
      if (m.cid === c.cid || presentes[m.cid]) return true;
      mudou = true;
      quemSaiuNoMeioDaPartida(c, m);
      return false;
    });
    // Quem chegou.
    Object.keys(presentes).forEach(function (cid) {
      if (cid === c.cid || presentes[cid].papel === 'anfitriao') return;
      if (sala.membros.some(function (m) { return m.cid === cid; })) return;
      if (sala.membros.length >= IT.config.MAX_JOGADORES) {
        enviar(c, 'cheia', { cid: cid });
        return;
      }
      sala.membros.push({
        cid: cid,
        nome: String(presentes[cid].nome || 'Explorador').slice(0, 12),
        cor: primeiraCorLivre(sala, presentes[cid].cor, cid)
      });
      mudou = true;
    });
    sala.cpus = Math.min(sala.cpus, IT.config.MAX_JOGADORES - sala.membros.length);
    if (mudou) {
      enviar(c, 'sala', sala);
      desenharSala();
    }
  }

  /* Um cliente saiu no meio da partida: a CPU joga por ele até o fim. */
  function quemSaiuNoMeioDaPartida(c, membro) {
    var jogo = IT.jogo;
    if (jogo.rede !== c || (jogo.estado !== 'jogando')) return;
    jogo.jogadores.forEach(function (j) {
      if (j.cid === membro.cid && j.tipo === 'humano') {
        jogo.transformarEmCPU(j, O.NIVEL_DE_QUEM_SAI);
        var texto = j.nome + ' saiu. A CPU vai jogar no lugar! 🤖';
        IT.ui.mostrarMensagem(texto, 'aviso', j.cor.escura);
        enviar(c, 'msg', { texto: texto, tipo: 'aviso', id: j.id });
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
        el.salaNivel.appendChild(botaoOpcao(IT.DIFICULDADES[chave].nome, sala.nivel === chave, function () {
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
        return c.canal.track({ nome: nome, cor: 'rosa', papel: 'anfitriao' })
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
      IT.jogo.irPara('sala');
      presencaMudou(c);
      desenharSala();
      // De tempos em tempos reenvia a sala (para quem chegou e perdeu alguma mensagem).
      c.timers.push(setInterval(function () { if (c.sala.estado === 'espera') enviar(c, 'sala', c.sala); }, 3000));
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
      return c.canal.track({ nome: nome, cor: null, papel: 'jogador' }).then(function () {
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
    c.sala.estado = 'jogando';
    c.sala.rodada++;
    c.rodada = c.sala.rodada;
    c.seq = 0;
    enviar(c, 'sala', c.sala);
    enviar(c, 'inicio', { r: c.rodada, configuracao: JSON.parse(JSON.stringify(configuracao)) });

    var jogo = IT.jogo;
    jogo.rede = c;
    jogo.aoAvisar = function (texto, tipo, id) { enviar(c, 'msg', { texto: texto, tipo: tipo, id: id }); };
    jogo.aoFim = function (lista, porTempo) {
      enviarSnapshot(c);
      enviar(c, 'fim', {
        r: c.rodada,
        porTempo: porTempo,
        ranking: lista.map(function (r) { return [r.jogador.id, r.celulas]; })
      });
      c.sala.estado = 'fim';
    };
    // Cada vaga humana: joga aqui só o próprio anfitrião; os outros, pela rede.
    configuracao.vagas.forEach(function (v) { v.local = v.cid === c.cid || v.tipo === 'cpu'; });
    jogo.jogar(configuracao);
    enviarSnapshot(c);

    // Transmissão do estado.
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
  }

  function resumoJogadores() {
    return IT.jogo.jogadores.map(function (j) {
      var e = j.explorador;
      return [e.x, e.y, e.alvoX, e.alvoY, Math.round(e.progresso * 100),
        e.direcao ? DIRS.indexOf(e.direcao) : -1, DIRS.indexOf(e.ultimaDirecao)];
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
    lento: 'Esperando o anfitrião… ⏳'
  };

  function mostrarPausaRemota(c, motivo) {
    c.pausaRemota = motivo || 0;
    IT.ui.avisoRede(motivo ? TEXTOS_PAUSA[motivo] || TEXTOS_PAUSA.menu : '');
  }

  /* Cliente: se as mensagens do anfitrião param de chegar, avisa. */
  function vigiarAnfitriao(c) {
    c.timers.push(setInterval(function () {
      var jogo = IT.jogo;
      if (con !== c || jogo.rede !== c || jogo.estado !== 'jogando') return;
      var parado = Date.now() - c.ultimaMensagemEm > 2500;
      if (parado && !c.pausaRemota) mostrarPausaRemota(c, 'lento');
      else if (!parado && c.pausaRemota === 'lento') mostrarPausaRemota(c, 0);
    }, 500));
  }

  function comecarComoCliente(c, p) {
    var configuracao = p.configuracao;
    configuracao.vagas.forEach(function (v) { v.local = v.cid === c.cid; });
    c.rodada = p.r;
    c.ultimoSeq = -1;
    var jogo = IT.jogo;
    jogo.rede = c;
    jogo.aoAvisar = null;
    jogo.aoFim = null;
    c.ultimaMensagemEm = Date.now();
    jogo.jogar(configuracao, { semIA: true });
    avisoSala('');
    if (!c.vigiando) { c.vigiando = true; vigiarAnfitriao(c); }
  }

  /* ---------- Mensagens recebidas ---------- */

  function receber(c, evento, p) {
    var jogo = IT.jogo;

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
      }
      return;
    }

    // Cliente.
    if (evento === 'sala') {
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
        jogo.irPara('sala');
      }
      desenharSala();
    } else if (evento === 'cheia') {
      if (p.cid !== c.cid) return;
      sair('');
      jogo.irPara('online');
      avisoOnline('Essa sala já está cheia (4 jogadores). 🙈');
    } else if (evento === 'inicio') {
      if (!c.sala || !p.configuracao.vagas.some(function (v) { return v.cid === c.cid; })) return;
      comecarComoCliente(c, p);
    } else if (evento === 'estado') {
      aplicarEstado(c, p, false);
    } else if (evento === 'snap') {
      aplicarEstado(c, p, true);
    } else if (evento === 'msg') {
      if (jogo.rede !== c) return;
      var j = p.id ? jogo.jogadorPorId(p.id) : null;
      IT.ui.mostrarMensagem(p.texto, p.tipo, j ? j.cor.escura : null);
      jogo.vibrarPara(j, p.tipo);
    } else if (evento === 'pausa') {
      if (jogo.rede === c) { c.ultimaMensagemEm = Date.now(); mostrarPausaRemota(c, p.motivo || 'menu'); }
    } else if (evento === 'retomar') {
      if (jogo.rede === c) { c.ultimaMensagemEm = Date.now(); mostrarPausaRemota(c, 0); }
    } else if (evento === 'fim') {
      if (jogo.rede !== c || p.r !== c.rodada || jogo.estado !== 'jogando') return;
      jogo.mostrarFimRemoto(p.ranking, p.porTempo);
    } else if (evento === 'voltarSala') {
      IT.ui.avisoRede('');
      jogo.rede = null;
      jogo.irPara('sala');
      desenharSala();
    }
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
      window.addEventListener('beforeunload', function () { fechar(con); });
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
    jogarDeNovo: function () {
      if (this.anfitriao) comecarPartida();
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

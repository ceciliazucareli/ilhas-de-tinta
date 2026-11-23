"""Quedas, reconexão e troca de anfitrião no online (issue #6), com o Supabase de verdade.

Dois Chromes separados (anfitrião e cliente) e um terceiro para quem chega no meio.
Os "sumiços" são de verdade, pelo protocolo de depuração do Chrome (CDP):
  - congelar a aba (Page.setWebLifecycleState frozen) — o que o celular faz ao bloquear a tela;
  - derrubar a conexão (fecha o WebSocket do Supabase) e desligar a rede (Network offline);
  - recarregar a página.

Uso:  python3 tests/celular/teste_quedas.py [cenários...]
      (ILHAS_URL, padrão http://localhost:8000/index.html; precisa de internet)
Cenários: sala5 sala20 salaCliente20 salaAlem salaRecarregar salaRecarregarAnfitriao
          jogo5 jogo20 jogoAlem jogoRecarregar jogoRecarregarAnfitriao jogoRede chegaNoMeio voltarSala
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
falhas = []
def ok(c, t):
    print(('ok    ' if c else 'FALHA ') + t); sys.stdout.flush()
    if not c: falhas.append(t)

def js_seguro(a, expr, padrao=None):
    try: return a.js(expr)
    except Exception: return padrao

def estado(a): return js_seguro(a, 'IlhasDeTinta.jogo.estado')
def conexao(a, campo): return js_seguro(a, 'IlhasDeTinta.online.conexao() && IlhasDeTinta.online.conexao().%s' % campo)
def texto(a, id_): return js_seguro(a, 'document.getElementById("%s").textContent' % id_, '')

def esperar(a, expr, limite):
    try: a.esperar(expr, limite); return True
    except Exception: return False

def congelar(a, segundos):
    so_congelar(a); time.sleep(segundos)
    descongelar(a)

def so_congelar(a):
    # Com a emulação de foco ligada a aba não fica oculta e não congela de verdade.
    a.cmd('Emulation.setFocusEmulationEnabled', enabled=False)
    a.cmd('Page.setWebLifecycleState', state='frozen')

def reconectou(a, limite=30):
    """Espera a reconexão DE FATO: depois de descongelar, o canal leva uns segundos
    para perceber que caiu; espera ou um 2º SUBSCRIBED, ou 10 s seguidos inscrito."""
    fim = time.time() + limite; estavel = None
    while time.time() < fim:
        h = js_seguro(a, 'IlhasDeTinta.online.conexao() ? JSON.stringify(IlhasDeTinta.online.conexao().historicoStatus) : "[]"', '[]')
        lista = json.loads(h)
        if sum(1 for x in lista if x.endswith('SUBSCRIBED')) >= 2 and lista and lista[-1].endswith('SUBSCRIBED'): return True
        if conexao(a, 'inscrito'):
            estavel = estavel or time.time()
            if time.time() - estavel > 10: return True
        else:
            estavel = None
        time.sleep(0.5)
    return False

def descongelar(a):
    # "A pessoa voltou": a aba sai do congelamento e volta para a frente (visível).
    a.cmd('Page.setWebLifecycleState', state='active')
    # No Chrome headless a aba continua "hidden" depois do congelamento; a
    # emulação de foco a deixa visível de novo (como quando a pessoa volta).
    a.cmd('Emulation.setFocusEmulationEnabled', enabled=True)

def recarregar(a):
    """Recarrega e espera a página NOVA (senão as checagens rodam na antiga)."""
    a.js('window.__paginaVelha = 1')
    a.cmd('Page.reload')
    assert esperar(a, 'window.__paginaVelha === undefined && document.readyState === "complete" && !!window.IlhasDeTinta', 25), 'recarregar'

def criar_sala(h, nome='Ana'):
    h.js('IlhasDeTinta.online.sair && IlhasDeTinta.online.conexao() && IlhasDeTinta.online.sair("")')
    h.js('document.getElementById("botao-online").click(); document.getElementById("online-nome").value="%s"; document.getElementById("online-criar").click()' % nome)
    assert esperar(h, 'IlhasDeTinta.jogo.estado === "sala"', 25), 'criar sala'
    return h.js('document.getElementById("sala-codigo").textContent').split('-')[1]

def entrar(c, codigo, nome='Beto'):
    c.js('IlhasDeTinta.online.conexao() && IlhasDeTinta.online.sair("")')
    c.js('document.getElementById("botao-online").click(); document.getElementById("online-nome").value="%s"; document.getElementById("online-codigo").value="%s"; document.getElementById("online-entrar").click()' % (nome, codigo))
    assert esperar(c, 'IlhasDeTinta.jogo.estado === "sala" || IlhasDeTinta.jogo.estado === "jogando"', 20), 'entrar'

def montar(h, c, tempo=None):
    codigo = criar_sala(h)
    entrar(c, codigo)
    assert esperar(h, 'IlhasDeTinta.online.conexao().sala.membros.length === 2', 15), 'dois na sala'
    if tempo: h.js('IlhasDeTinta.config.TEMPO_LIMITE = %d' % tempo)
    return codigo

def comecar(h, c, cpus=1):
    h.js('document.querySelectorAll("#sala-cpus .opcao")[%d].click()' % cpus); time.sleep(0.3)
    h.js('document.getElementById("sala-jogar").click()')
    assert esperar(c, 'IlhasDeTinta.jogo.estado === "jogando"', 10) and esperar(h, 'IlhasDeTinta.jogo.estado === "jogando"', 5), 'partida começar'

def conversa_ok(h, c):
    """Depois de uma queda: o anfitrião muda as CPUs e o cliente enxerga (sala de espera)."""
    n = 1 if js_seguro(h, 'IlhasDeTinta.online.conexao().sala.cpus') == 0 else 0
    h.js('document.querySelectorAll("#sala-cpus .opcao")[%d].click()' % n)
    return esperar(c, 'IlhasDeTinta.online.conexao().sala.cpus === %d' % n, 10)

def jogo_anda(a, segundos=2.0):
    t1 = js_seguro(a, 'IlhasDeTinta.jogo.tempoRestante'); time.sleep(segundos)
    t2 = js_seguro(a, 'IlhasDeTinta.jogo.tempoRestante')
    andou = t1 is not None and t2 is not None and t2 < t1 - segundos / 2
    if not andou: print('      (relógio: %s → %s; estado: %s)' % (t1, t2, estado(a)))
    return andou

def mapas_iguais(a, b):
    # Os dois são lidos um depois do outro: compara algumas vezes e fica com a menor diferença.
    difs = []
    for _ in range(4):
        g1 = js_seguro(a, 'Array.prototype.join.call(IlhasDeTinta.jogo.grade.donos,"")', '')
        g2 = js_seguro(b, 'Array.prototype.join.call(IlhasDeTinta.jogo.grade.donos,"")', '')
        if not g1 or not g2 or len(g1) != len(g2): difs.append(99999); continue
        difs.append(sum(1 for p, q in zip(g1, g2) if p != q)); time.sleep(0.2)
    if min(difs) > 30: print('      (diferença entre os mapas: %s células)' % difs)
    return min(difs) <= 30

# ---------------- cenários ----------------

def sala5(h, c, x):
    montar(h, c)
    congelar(h, 5)
    ok(reconectou(h), 'sala: anfitrião congelado 5 s reconectou (status: %s)' % conexao(h, 'historicoStatus.slice(-3).join(", ")'))
    ok(estado(h) == 'sala' and estado(c) == 'sala', 'sala: ninguém saiu da sala')
    ok(conversa_ok(h, c), 'sala: depois da queda, o que o anfitrião muda chega no cliente')

def sala20(h, c, x):
    montar(h, c)
    congelar(h, 20)
    aviso = texto(c, 'sala-aviso')
    print('      aviso no cliente logo depois:', repr(aviso))
    ok(reconectou(h), 'sala: anfitrião congelado 20 s reconectou')
    ok(estado(c) == 'sala' and not conexao(c, 'anfitriao'), 'sala: o cliente esperou (não virou anfitrião antes da tolerância de 60 s)')
    ok(conversa_ok(h, c), 'sala: depois de 20 s fora, a sala funciona normal')

def salaCliente20(h, c, x):
    montar(h, c)
    congelar(c, 20)
    marca = js_seguro(h, 'document.getElementById("sala-jogadores").innerText')
    print('      lista no anfitrião logo depois:', repr(marca.replace("\n", " | ") if marca else marca))
    ok(reconectou(c), 'sala: cliente congelado 20 s reconectou')
    ok(esperar(h, 'IlhasDeTinta.online.conexao().sala.membros.length === 2 && !IlhasDeTinta.online.conexao().sala.membros.some(function(m){return m.ausenteDesde})', 15),
       'sala: o cliente continua na lista e o "saiu um pouquinho" sumiu')
    ok(conversa_ok(h, c), 'sala: anfitrião e cliente continuam conversando')

def salaAlem(h, c, x):
    montar(h, c)
    t0 = time.time()
    so_congelar(h)
    virou = esperar(c, 'IlhasDeTinta.online.conexao() && IlhasDeTinta.online.conexao().anfitriao', 120)
    ok(virou, 'sala: anfitrião fora além da tolerância → o cliente virou o anfitrião depois de %.0f s' % (time.time() - t0))
    descongelar(h)
    ok(esperar(h, 'IlhasDeTinta.online.conexao() && !IlhasDeTinta.online.conexao().anfitriao && IlhasDeTinta.jogo.estado === "sala"', 30),
       'sala: o antigo anfitrião voltou como jogador comum (mesma sala)')
    ok(esperar(c, 'IlhasDeTinta.online.conexao().sala.membros.length === 2', 20), 'sala: os dois continuam na sala, com o novo anfitrião')

def salaRecarregar(h, c, x):
    codigo = montar(h, c)
    cid = conexao(c, 'cid')
    recarregar(c)
    ok(esperar(c, 'IlhasDeTinta.jogo && IlhasDeTinta.jogo.estado === "sala"', 25), 'sala: cliente recarregou a página e voltou para a sala sozinho')
    ok(conexao(c, 'cid') == cid and texto(c, 'sala-codigo').endswith(codigo), 'sala: com a mesma identidade e o mesmo código')
    ok(esperar(h, 'IlhasDeTinta.online.conexao().sala.membros.length === 2', 10), 'sala: o anfitrião vê os mesmos 2 jogadores')

def salaRecarregarAnfitriao(h, c, x):
    codigo = montar(h, c)
    recarregar(h)
    ok(esperar(c, 'IlhasDeTinta.online.conexao() && IlhasDeTinta.online.conexao().anfitriao', 20), 'sala: anfitrião recarregou → o cliente assumiu a sala na hora')
    ok(esperar(h, 'IlhasDeTinta.jogo && IlhasDeTinta.jogo.estado === "sala" && IlhasDeTinta.online.conexao() && !IlhasDeTinta.online.conexao().anfitriao', 25),
       'sala: quem recarregou voltou para a mesma sala, como jogador')
    ok(texto(h, 'sala-codigo').endswith(codigo), 'sala: mesmo código')

def jogo5(h, c, x):
    montar(h, c, tempo=60); comecar(h, c)
    time.sleep(2)
    congelar(c, 5)
    ok(reconectou(c), 'partida: cliente congelado 5 s reconectou')
    ok(estado(c) == 'jogando' and jogo_anda(c), 'partida: o cliente continua vendo a partida andar')
    ok(esperar(h, 'IlhasDeTinta.jogo.jogadores.filter(function(j){return j.nome==="Beto"})[0].tipo === "humano"', 15), 'partida: o Beto voltou a controlar o próprio explorador')
    ok(mapas_iguais(h, c), 'partida: mapa igual nos dois')

def jogo20(h, c, x):
    montar(h, c, tempo=90); comecar(h, c)
    time.sleep(2)
    congelar(h, 20)
    aviso = texto(c, 'aviso-rede')
    ok(not conexao(c, 'anfitriao'), 'partida: anfitrião congelado 20 s — o cliente esperou (aviso: "%s")' % aviso)
    ok(reconectou(h), 'partida: o anfitrião reconectou')
    # A aba ficou oculta: o jogo do anfitrião pausou sozinho; ao voltar ele toca em Continuar.
    if js_seguro(h, 'IlhasDeTinta.jogo.menuAberto'):
        print('      (o anfitrião voltou na tela de pausa e tocou em Continuar)')
        h.js('document.getElementById("pausa-continuar").click()')
    ok(esperar(c, 'document.getElementById("aviso-rede").hidden', 15) and jogo_anda(c), 'partida: o aviso sumiu e a partida voltou a andar no cliente')
    ok(mapas_iguais(h, c), 'partida: mapa igual nos dois')

def jogoAlem(h, c, x):
    montar(h, c, tempo=120); comecar(h, c)
    time.sleep(2)
    t0 = time.time()
    so_congelar(h)
    virou = esperar(c, 'IlhasDeTinta.online.conexao().anfitriao', 60)
    ok(virou, 'partida: anfitrião fora além da tolerância → o cliente assumiu em %.0f s' % (time.time() - t0))
    ok(jogo_anda(c), 'partida: a partida continua com o novo anfitrião')
    descongelar(h)
    ok(esperar(h, 'IlhasDeTinta.online.conexao() && !IlhasDeTinta.online.conexao().anfitriao', 30), 'partida: o antigo anfitrião voltou como jogador comum')
    ok(esperar(c, 'IlhasDeTinta.jogo.jogadores.filter(function(j){return j.nome==="Ana"})[0].tipo === "humano"', 20), 'partida: a Ana recebeu o explorador de volta')
    ok(esperar(h, 'IlhasDeTinta.jogo.estado === "jogando"', 5) and jogo_anda(h), 'partida: o antigo anfitrião vê a partida andando')

def jogoRecarregar(h, c, x):
    montar(h, c, tempo=90); comecar(h, c)
    time.sleep(2)
    recarregar(c)
    ok(esperar(c, 'IlhasDeTinta.jogo && IlhasDeTinta.jogo.estado === "jogando" && IlhasDeTinta.online.conexao() && !IlhasDeTinta.online.conexao().espectador', 25),
       'partida: cliente recarregou e voltou para dentro da partida (jogando, não assistindo)')
    ok(jogo_anda(c) and mapas_iguais(h, c), 'partida: recebeu o estado completo (mapa igual, relógio andando)')
    ok(esperar(h, 'IlhasDeTinta.jogo.jogadores.filter(function(j){return j.nome==="Beto"})[0].tipo === "humano"', 15), 'partida: o Beto continua com o próprio explorador')

def jogoRecarregarAnfitriao(h, c, x):
    montar(h, c, tempo=90); comecar(h, c)
    time.sleep(2)
    recarregar(h)
    ok(esperar(c, 'IlhasDeTinta.online.conexao().anfitriao', 20), 'partida: anfitrião recarregou → o cliente assumiu na hora')
    ok(esperar(h, 'IlhasDeTinta.jogo && IlhasDeTinta.jogo.estado === "jogando" && IlhasDeTinta.online.conexao() && !IlhasDeTinta.online.conexao().anfitriao', 25),
       'partida: quem recarregou voltou para a partida como jogador')
    ok(jogo_anda(h) and mapas_iguais(h, c), 'partida: mapa igual e relógio andando nos dois')
    ok(esperar(c, 'IlhasDeTinta.jogo.jogadores.filter(function(j){return j.nome==="Ana"})[0].tipo === "humano"', 15), 'partida: a Ana continua com o próprio explorador')

def jogoRede(h, c, x):
    montar(h, c, tempo=90); comecar(h, c)
    time.sleep(2)
    # Derruba o WebSocket do Supabase e desliga a rede por 8 s.
    c.cmd('Network.enable')
    c.cmd('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
    c.js('dispatchEvent(new Event("offline")); (window.__sockets || []).forEach(function (s) { try { s.close(); } catch (e) {} })')
    time.sleep(8)
    ok(not conexao(c, 'inscrito'), 'rede: cliente sem internet ficou desconectado (aviso: "%s")' % texto(c, 'aviso-rede'))
    c.cmd('Network.emulateNetworkConditions', offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)
    c.js('dispatchEvent(new Event("online"))')
    ok(esperar(c, 'IlhasDeTinta.online.conexao().inscrito', 25), 'rede: a internet voltou e o cliente reconectou sozinho')
    ok(esperar(c, 'IlhasDeTinta.jogo.estado === "jogando"', 5) and jogo_anda(c) and mapas_iguais(h, c), 'rede: partida continua e mapa igual')

def chegaNoMeio(h, c, x):
    codigo = montar(h, c, tempo=25); comecar(h, c)
    time.sleep(2)
    entrar(x, codigo, 'Caio')
    ok(esperar(x, 'IlhasDeTinta.jogo.estado === "jogando" && IlhasDeTinta.online.conexao().espectador', 15), 'chegou no meio: assiste a partida (espectador)')
    ok(not js_seguro(x, 'document.getElementById("faixa-espectador").hidden', True), 'chegou no meio: aparece "👀 Assistindo! Você entra na próxima partida."')
    x.foto('/tmp/ilhas-espectador.png')
    ok(jogo_anda(x) and mapas_iguais(h, x), 'chegou no meio: vê a mesma partida andando')
    ok(js_seguro(x, 'IlhasDeTinta.online.conexao().direcionar("cima")') is False, 'chegou no meio: não controla ninguém (só assiste)')
    for a in (h, c, x): esperar(a, 'IlhasDeTinta.jogo.estado === "fim"', 45)
    ok(estado(x) == 'fim', 'chegou no meio: vê o ranking no fim')
    # Revanche: os dois que jogaram votam; o Caio entra na próxima.
    h.js('document.getElementById("botao-jogar-de-novo").click()'); c.js('document.getElementById("botao-jogar-de-novo").click()')
    ok(esperar(x, 'IlhasDeTinta.jogo.estado === "jogando" && !IlhasDeTinta.online.conexao().espectador', 15), 'chegou no meio: na revanche o Caio joga')
    ok(js_seguro(h, 'IlhasDeTinta.jogo.jogadores.some(function(j){return j.nome==="Caio"})'), 'chegou no meio: o Caio está na partida nova')
    x.js('IlhasDeTinta.online.sair("")')

def voltarSala(h, c, x):
    montar(h, c, tempo=12); comecar(h, c)
    for a in (h, c): esperar(a, 'IlhasDeTinta.jogo.estado === "fim"', 30)
    ok(texto(h, 'botao-mudar-jogadores') == 'Voltar para a sala', 'voltar para a sala: o anfitrião vê o botão')
    h.js('document.getElementById("botao-mudar-jogadores").click()')
    ok(esperar(c, 'IlhasDeTinta.jogo.estado === "sala"', 10) and estado(h) == 'sala', 'voltar para a sala: os dois voltaram para a sala de espera')
    ok(esperar(c, 'IlhasDeTinta.online.conexao().sala.membros.length === 2', 5), 'voltar para a sala: com os mesmos jogadores')
    h.js('document.getElementById("sala-jogar").click()')
    ok(esperar(c, 'IlhasDeTinta.jogo.estado === "jogando"', 10), 'voltar para a sala: dá para começar outra partida dali')

TODOS = ['sala5', 'sala20', 'salaCliente20', 'salaRecarregar', 'salaRecarregarAnfitriao', 'jogo5', 'jogo20',
         'jogoRecarregar', 'jogoRecarregarAnfitriao', 'jogoRede', 'chegaNoMeio', 'voltarSala', 'jogoAlem', 'salaAlem']

def abrir_navegadores():
    chromes = [Chrome(9431, '/tmp/quedas-h'), Chrome(9432, '/tmp/quedas-c'), Chrome(9433, '/tmp/quedas-x')]
    abas = []
    for ch_ in chromes:
        a = ch_.nova_aba(); a.instalar_coletor_de_erros()
        # Guarda os WebSockets da página (para o teste de rede derrubá-los de verdade).
        a.cmd('Page.addScriptToEvaluateOnNewDocument', source='''(function(){ var W = window.WebSocket; window.__sockets = [];
          window.WebSocket = function (u, p) { var s = p ? new W(u, p) : new W(u); window.__sockets.push(s); return s; };
          window.WebSocket.prototype = W.prototype; ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){ window.WebSocket[k] = W[k]; }); })();''')
        a.desktop(1100, 760); a.ir(URL); abas.append(a)
    return chromes, abas

if __name__ == '__main__':
    escolhidos = sys.argv[1:] or TODOS
    for nome in escolhidos:
        # Navegadores novos a cada cenário: nada de um cenário atrapalha o outro.
        print('== ' + nome); t = time.time()
        chromes, (h, c, x) = abrir_navegadores()
        try:
            globals()[nome](h, c, x)
            for a, quem in ((h, 'anfitrião'), (c, 'cliente'), (x, 'terceiro')):
                e = js_seguro(a, 'JSON.stringify(window.__erros || [])', '?')
                if e != '[]': ok(False, 'erros no console (%s): %s' % (quem, e))
        except Exception as e:
            ok(False, '%s interrompido: %s' % (nome, e))
        finally:
            for ch_ in chromes: ch_.fechar()
        print('   (%.0f s)' % (time.time() - t))
        time.sleep(1)
    print('FALHAS:', len(falhas))
    sys.exit(1 if falhas else 0)

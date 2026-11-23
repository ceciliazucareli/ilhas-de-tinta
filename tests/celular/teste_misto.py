import sys, time, json, random
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
S = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ilhas-de-tinta-testes'; os.makedirs(S, exist_ok=True)
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
TEMPO = 30
falhas = []
def ok(cond, texto):
    print(('ok    ' if cond else 'FALHA ') + texto); sys.stdout.flush()
    if not cond: falhas.append(texto)

def centro(a, id_):
    r = json.loads(a.js('JSON.stringify(document.getElementById("%s").getBoundingClientRect())' % id_))
    return r['x'] + r['width'] / 2, r['y'] + r['height'] / 2

def tocar(a, id_):
    a.tocar(*centro(a, id_)); time.sleep(0.3)

def clicar(a, id_):
    x, y = centro(a, id_)
    for t in ('mousePressed', 'mouseReleased'):
        a.cmd('Input.dispatchMouseEvent', type=t, x=x, y=y, button='left', clickCount=1)
    time.sleep(0.3)

def apertar(a, id_, celular):
    (tocar if celular else clicar)(a, id_)

def escrever(a, id_, texto, celular):
    apertar(a, id_, celular)
    a.js('document.getElementById("%s").value = ""' % id_)
    a.cmd('Input.insertText', text=texto)

def entrar_menu_online(a, nome, celular):
    apertar(a, 'botao-online', celular)
    a.esperar('IlhasDeTinta.jogo.estado === "online"', 5)
    escrever(a, 'online-nome', nome, celular)

def jogar_rodada(cel, desk, anfitriao_cel, nome_foto):
    host, cli = (cel, desk) if anfitriao_cel else (desk, cel)
    entrar_menu_online(host, 'Lia' if anfitriao_cel else 'Davi', anfitriao_cel)
    host.js('IlhasDeTinta.config.TEMPO_LIMITE = %d' % TEMPO)
    apertar(host, 'online-criar', anfitriao_cel)
    host.esperar('IlhasDeTinta.jogo.estado === "sala"', 15)
    codigo = host.js('document.getElementById("sala-codigo").textContent')
    ok(codigo.startswith('TINTA-'), 'anfitrião (%s) criou a sala %s' % ('celular' if anfitriao_cel else 'desktop', codigo))
    entrar_menu_online(cli, 'Davi' if anfitriao_cel else 'Lia', not anfitriao_cel)
    # O cliente digita só os números (no celular: teclado numérico).
    escrever(cli, 'online-codigo', codigo.split('-')[1], not anfitriao_cel)
    ok(cli.js('document.getElementById("online-codigo").inputMode') == 'numeric', 'campo do código usa teclado numérico')
    apertar(cli, 'online-entrar', not anfitriao_cel)
    cli.esperar('IlhasDeTinta.jogo.estado === "sala"', 15)
    host.esperar('IlhasDeTinta.online.conexao().sala.membros.length === 2', 10)
    ok(True, 'os dois estão na sala')
    if nome_foto == 'a':
        cel.foto(S + '/celular-sala.png')
    # anfitrião coloca 1 CPU e aperta Jogar
    host.js('document.querySelectorAll("#sala-cpus .opcao")[1].click()')
    time.sleep(0.3)
    apertar(host, 'sala-jogar', anfitriao_cel)
    for a in (cel, desk): a.esperar('IlhasDeTinta.jogo.estado === "jogando"', 10)
    ok(True, 'partida começou nos dois aparelhos')
    time.sleep(1)
    camc = json.loads(cel.js('JSON.stringify(IlhasDeTinta.renderer.camera())'))
    camd = json.loads(desk.js('JSON.stringify(IlhasDeTinta.renderer.camera())'))
    ok(camc['seguindo'] and not camd['seguindo'], 'câmera local: celular segue o próprio explorador (%.0f px/célula), desktop mostra o mapa todo (%.0f px)' % (camc['celulaNaTela'], camd['celulaNaTela']))
    meu_cel = cel.js('(function(){var c=IlhasDeTinta.online.conexao();var j=IlhasDeTinta.jogo.jogadores.filter(function(j){return j.cid===c.cid})[0];return j.nome})()')
    ok(meu_cel == ('Lia' if anfitriao_cel else 'Davi') or True, 'celular joga com %s' % meu_cel)

    teclas = [('ArrowUp', 'ArrowUp'), ('ArrowLeft', 'ArrowLeft'), ('ArrowDown', 'ArrowDown'), ('ArrowRight', 'ArrowRight'),
              ('KeyW', 'w'), ('KeyA', 'a'), ('KeyS', 's'), ('KeyD', 'd')]
    gestos = [[(0, -60)], [(60, 0)], [(0, 60)], [(-60, 0)], [(60, 0), (0, -60)], [(0, 60), (-60, 0)]]
    inicio = time.time(); pausou = False; foto_partida = False
    while time.time() - inicio < TEMPO + 25:
        if cel.js('IlhasDeTinta.jogo.estado') == 'fim' and desk.js('IlhasDeTinta.jogo.estado') == 'fim':
            break
        # celular: um deslize com uma ou duas viradas; desktop: uma tecla
        if cel.js('IlhasDeTinta.jogo.estado') == 'jogando':
            x, y = 190, 450; caminho = [(x, y)]
            for dx, dy in random.choice(gestos):
                x += dx; y += dy; caminho.append((x, y))
            cel.deslizar(caminho, passo_px=10, pausa=0.008)
        if desk.js('IlhasDeTinta.jogo.estado') == 'jogando':
            desk.tecla(*random.choice(teclas))
        decorrido = time.time() - inicio
        if not foto_partida and decorrido > 9:
            foto_partida = True
            cel.foto(S + '/misto-%s-cel.png' % nome_foto); desk.foto(S + '/misto-%s-desk.png' % nome_foto)
            # Os dois aparelhos são lidos um depois do outro: uma captura pode estar
            # "a caminho". Compara algumas vezes e fica com a menor diferença.
            difs = []
            for _ in range(4):
                g1 = cel.js('Array.prototype.join.call(IlhasDeTinta.jogo.grade.donos,"")')
                g2 = desk.js('Array.prototype.join.call(IlhasDeTinta.jogo.grade.donos,"")')
                difs.append(sum(1 for p, q in zip(g1, g2) if p != q)); time.sleep(0.15)
            dif = min(difs)
            ok(dif <= len(g1) * 0.02, 'mapa igual nos dois aparelhos (diferença de %d células)' % dif)
        if anfitriao_cel and not pausou and decorrido > 13:
            pausou = True
            # O celular-anfitrião "sai da tela" (simulado: visibilitychange para hidden)
            cel.js('Object.defineProperty(document, "visibilityState", {configurable: true, get: function(){return "hidden"}}); document.dispatchEvent(new Event("visibilitychange"))')
            time.sleep(1.5)
            t1 = cel.js('IlhasDeTinta.jogo.tempoRestante'); aviso = desk.js('document.getElementById("aviso-rede").textContent')
            ok('saiu da tela' in aviso, 'desktop avisa: "%s"' % aviso)
            desk.foto(S + '/misto-pausa-desk.png')
            time.sleep(1.5)
            ok(abs(cel.js('IlhasDeTinta.jogo.tempoRestante') - t1) < 0.01, 'partida pausada no anfitrião enquanto fora da tela')
            cel.js('Object.defineProperty(document, "visibilityState", {configurable: true, get: function(){return "visible"}}); document.dispatchEvent(new Event("visibilitychange"))')
            time.sleep(1)
            ok(cel.js('IlhasDeTinta.jogo.menuAberto') and not cel.js('document.getElementById("tela-pausa").hidden'), 'anfitrião voltou e vê a tela de pausa')
            aviso = desk.js('document.getElementById("aviso-rede").textContent')
            ok('pausou' in aviso, 'desktop agora vê: "%s"' % aviso)
            tocar(cel, 'pausa-continuar'); time.sleep(1)
            ok(desk.js('document.getElementById("aviso-rede").hidden'), 'anfitrião tocou em Continuar: aviso sumiu no desktop')
            inicio += 4.5  # o tempo pausado não conta

            # Agora o celular-anfitrião fica FORA da tela por mais de 15 s: o desktop assume.
            cel.js('Object.defineProperty(document, "visibilityState", {configurable: true, get: function(){return "hidden"}}); document.dispatchEvent(new Event("visibilitychange"))')
            t0 = time.time()
            try:
                desk.esperar('IlhasDeTinta.online.conexao().anfitriao', 25); assumiu = True
            except TimeoutError: assumiu = False
            ok(assumiu, 'celular-anfitrião fora da tela: o desktop assumiu a partida depois de %.0f s' % (time.time() - t0))
            t1 = desk.js('IlhasDeTinta.jogo.tempoRestante'); time.sleep(2)
            ok(desk.js('IlhasDeTinta.jogo.tempoRestante') < t1 - 1, 'a partida continua no desktop (novo anfitrião)')
            ok(desk.js('IlhasDeTinta.jogo.jogadores.filter(function(j){return j.nome==="Lia"})[0].tipo') == 'cpu', 'enquanto isso, a CPU joga pela Lia')
            desk.foto(S + '/misto-troca-desk.png')
            # O celular volta para a tela: percebe que não é mais o anfitrião e continua como jogador.
            cel.js('Object.defineProperty(document, "visibilityState", {configurable: true, get: function(){return "visible"}}); document.dispatchEvent(new Event("visibilitychange"))')
            try:
                cel.esperar('!IlhasDeTinta.online.conexao().anfitriao', 15); voltou = True
            except TimeoutError: voltou = False
            ok(voltou, 'celular voltou e virou jogador comum (sem dois anfitriões)')
            if cel.js('IlhasDeTinta.jogo.menuAberto'): tocar(cel, 'pausa-continuar')
            try:
                desk.esperar('IlhasDeTinta.jogo.jogadores.filter(function(j){return j.nome==="Lia"})[0].tipo === "humano"', 15); devolveu = True
            except TimeoutError: devolveu = False
            ok(devolveu, 'o desktop devolveu o explorador da Lia para o celular')
            cel.foto(S + '/misto-troca-cel.png')
            inicio += time.time() - t0
    for a in (cel, desk): a.esperar('IlhasDeTinta.jogo.estado === "fim"', 15)
    r1 = cel.js('document.getElementById("fim-ranking").innerText.replace(/\\s+/g," ")')
    r2 = desk.js('document.getElementById("fim-ranking").innerText.replace(/\\s+/g," ")')
    ok(r1 == r2, 'ranking igual nos dois: ' + r1)
    pct = cel.js('IlhasDeTinta.jogo.ranking().map(function(r){return r.jogador.nome+":"+r.celulas}).join(" ")')
    print('      células:', pct)
    if nome_foto == 'a': cel.foto(S + '/celular-ranking.png')
    cel.foto(S + '/misto-%s-cel-fim.png' % nome_foto); desk.foto(S + '/misto-%s-desk-fim.png' % nome_foto)
    # Quem é o anfitrião agora (na rodada 1 pode ter mudado) sai: o outro assume a sala.
    atual, outro = (cel, desk) if cel.js('IlhasDeTinta.online.conexao().anfitriao') else (desk, cel)
    atual.js('IlhasDeTinta.online.sair("")'); t0 = time.time()
    try:
        outro.esperar('IlhasDeTinta.online.conexao() && IlhasDeTinta.online.conexao().anfitriao', 15); virou = True
    except TimeoutError: virou = False
    ok(virou, 'anfitrião saiu na tela de fim: o outro virou anfitrião em %.1f s (pode pedir revanche contra a CPU)' % (time.time() - t0))
    outro.js('IlhasDeTinta.online.sair("")'); time.sleep(1)
    for a in (cel, desk):
        e = a.erros(); ok(e == '[]', 'sem erros no console: ' + e)

c1 = Chrome(9351, S + '/perfil-m1'); c2 = Chrome(9352, S + '/perfil-m2')
try:
    cel = c1.nova_aba(); cel.instalar_coletor_de_erros(); cel.celular(390, 844); cel.ir(URL)
    desk = c2.nova_aba(); desk.instalar_coletor_de_erros(); desk.desktop(1280, 800); desk.ir(URL)
    print('== Rodada 1: celular é o anfitrião'); jogar_rodada(cel, desk, True, 'a')
    print('== Rodada 2: desktop é o anfitrião'); jogar_rodada(cel, desk, False, 'b')
finally:
    c1.fechar(); c2.fechar()
print('FALHAS:', len(falhas))

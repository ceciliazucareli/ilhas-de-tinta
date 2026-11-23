import sys, time, json
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
S = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ilhas-de-tinta-testes'; os.makedirs(S, exist_ok=True)
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
ch = Chrome(9341, S + '/perfil-cel')
try:
    a = ch.nova_aba()
    a.instalar_coletor_de_erros()
    a.celular(390, 844)
    a.ir(URL)
    time.sleep(1)
    print('estado inicial:', a.js('IlhasDeTinta.jogo.estado'), '| toque:', a.js('document.body.classList.contains("toque")'))
    print('rolagem horizontal?', a.js('document.documentElement.scrollWidth > innerWidth'))
    a.foto(S + '/celular-menu.png')
    r = a.js('JSON.stringify(document.getElementById("botao-offline").getBoundingClientRect())'); r = json.loads(r)
    a.tocar(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2); time.sleep(0.5)
    print('após tocar Offline:', a.js('IlhasDeTinta.jogo.estado'), '| título:', a.js('document.getElementById("setup-titulo").textContent'))
    a.foto(S + '/celular-config.png')
    a.js('IlhasDeTinta.setup.modoSimples(true, 3)')
    r = json.loads(a.js('JSON.stringify(document.getElementById("botao-jogar").getBoundingClientRect())'))
    a.tocar(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2); time.sleep(0.8)
    print('jogando:', a.js('IlhasDeTinta.jogo.estado + " jogadores=" + IlhasDeTinta.jogo.jogadores.length + " dica=" + !document.getElementById("dica-inicio").hidden + " texto=" + document.getElementById("dica-texto").textContent'))
    print('câmera:', a.js('JSON.stringify(IlhasDeTinta.renderer.camera())'))
    a.foto(S + '/celular-dica.png')
    # registra os pedidos de direção do explorador local
    a.js('''(function(){ var e = IlhasDeTinta.jogo.jogadores[0].explorador; window.__pedidos = [];
         var o = e.pedirDirecao; e.pedirDirecao = function (d) { var r = o.call(e, d); window.__pedidos.push(d + (r ? "" : "(recusada)")); return r; }; })()''')
    # Um arrasto só, sem soltar: direita, cima, esquerda, cima
    a.deslizar([(200, 500), (260, 500), (262, 440), (200, 438), (198, 380)])
    time.sleep(0.2)
    print('pedidos no mesmo arrasto:', a.js('JSON.stringify(window.__pedidos)'), '| dica escondida:', a.js('document.getElementById("dica-inicio").hidden'))
    time.sleep(1.5)
    e = json.loads(a.js('JSON.stringify((function(e){return {x:e.x,y:e.y,dir:e.direcao,ult:e.ultimaDirecao}})(IlhasDeTinta.jogo.jogadores[0].explorador))'))
    print('explorador:', e)
    # swipe curto (abaixo do limiar) não deve virar
    a.js('window.__pedidos = []'); a.deslizar([(200, 600), (212, 604)])
    print('swipe curto (12px):', a.js('JSON.stringify(window.__pedidos)'))
    # toque e segura: nada acontece
    a.toque('touchStart', [(150, 650)]); time.sleep(0.8); a.toque('touchEnd', [])
    print('toque e segura:', a.js('JSON.stringify(window.__pedidos)'), '| seleção:', repr(a.js('String(getSelection())')))
    time.sleep(2)
    print('câmera depois:', a.js('JSON.stringify(IlhasDeTinta.renderer.camera())'), '| rolagem:', a.js('scrollX + "," + scrollY'))
    a.foto(S + '/celular-partida-retrato.png')
    # paisagem
    a.celular(844, 390, retrato=False); time.sleep(1)
    print('paisagem câmera:', a.js('JSON.stringify(IlhasDeTinta.renderer.camera())'))
    a.foto(S + '/celular-partida-paisagem.png')
    a.celular(390, 844); time.sleep(0.5)
    a.js('IlhasDeTinta.jogo.tempoRestante = 0.01'); time.sleep(2.5)
    print('fim:', a.js('IlhasDeTinta.jogo.estado'))
    a.foto(S + '/celular-ranking-cpu.png')
    print('erros:', a.erros())
finally:
    ch.fechar()

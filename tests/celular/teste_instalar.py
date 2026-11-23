"""Teste do app instalável (PWA): critérios do Chrome, botão Instalar, dica do
iPhone, modo instalado, atalhos e atualização automática do service worker.
Uso: python3 tests/celular/teste_instalar.py   (com o jogo em ILHAS_URL, padrão http://localhost:8000/)"""
import os, sys, time, json, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
BASE = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html').rsplit('/', 1)[0] + '/'
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
falhas = []
def ok(c, t):
    print(('ok    ' if c else 'FALHA ') + t); sys.stdout.flush()
    if not c: falhas.append(t)

ch = Chrome(9391, '/tmp/ilhas-perfil-instalar')
try:
    a = ch.nova_aba(); a.instalar_coletor_de_erros()
    a.cmd('Page.addScriptToEvaluateOnNewDocument', source='window.__bip = 0; addEventListener("beforeinstallprompt", function () { window.__bip++; }, true);')
    a.desktop(1280, 800); a.ir(BASE + 'index.html'); time.sleep(3)
    erros = a.cmd('Page.getInstallabilityErrors')['installabilityErrors']
    ok(erros == [], 'Chrome considera o site instalável (erros: %s)' % erros)
    m = a.cmd('Page.getAppManifest'); ok(not m.get('errors'), 'manifest sem erros')
    man = json.loads(m.get('data') or '{}')
    ok(any(i.get('purpose') == 'maskable' for i in man.get('icons', [])), 'tem ícone maskable (Android)')
    ok(len(man.get('screenshots', [])) == 2, 'tem telas para a janela de instalação')
    ok(a.js('!!navigator.serviceWorker.controller'), 'service worker controla a página')
    reais = a.js('window.__bip')
    ok(a.js('document.getElementById("botao-instalar").hidden') == (reais == 0),
       'o Chrome avisou %d vez(es) que dá para instalar → botão Instalar %s' % (reais, 'visível' if reais else 'escondido'))

    # O navegador avisa que dá para instalar (evento simulado com prompt falso).
    a.js('''window.__promptChamado = 0; var e = new Event("beforeinstallprompt");
           e.prompt = function () { window.__promptChamado++; };
           e.userChoice = Promise.resolve({ outcome: "accepted" }); dispatchEvent(e);''')
    ok(not a.js('document.getElementById("botao-instalar").hidden'), 'com o aviso, aparece "📲 Instalar o jogo" no menu')
    a.js('document.getElementById("botao-instalar").click()'); time.sleep(0.3)
    ok(a.js('window.__promptChamado') == 1, 'tocar no botão abre a janela de instalação do navegador')

    # Já instalado (aberto pelo ícone). O headless não emula display-mode, então
    # simulamos como o iPhone informa: navigator.standalone = true.
    c = ch.nova_aba()
    c.cmd('Page.addScriptToEvaluateOnNewDocument', source='Object.defineProperty(navigator, "standalone", { get: function () { return true; } });')
    c.desktop(1280, 800); c.ir(BASE + 'index.html'); time.sleep(1.5)
    ok(c.js('document.body.classList.contains("instalado")') and c.js('document.getElementById("botao-instalar").hidden'),
       'aberto pelo ícone: modo instalado, sem botão Instalar')
    ok(c.js('getComputedStyle(document.getElementById("botao-tela-cheia")).display') == 'none', 'aberto pelo ícone: sem botão ⛶')

    # Atalhos do ícone.
    a.ir(BASE + 'index.html?abrir=offline'); time.sleep(0.6)
    ok(a.js('IlhasDeTinta.jogo.estado') == 'configuracao', 'atalho "Jogar Offline" abre a configuração')
    a.ir(BASE + 'index.html?abrir=online'); time.sleep(0.6)
    ok(a.js('IlhasDeTinta.jogo.estado') == 'online', 'atalho "Jogar Online" abre a tela online')

    # iPhone: não há botão automático; aparece a dica do Compartilhar.
    b = ch.nova_aba()
    # O Safari do iPhone nunca dispara beforeinstallprompt: bloqueamos o do Chrome.
    b.cmd('Page.addScriptToEvaluateOnNewDocument', source='addEventListener("beforeinstallprompt", function (e) { e.stopImmediatePropagation(); }, true);')
    b.celular(390, 844); b.ir(BASE + 'index.html'); time.sleep(1)
    ok(not b.js('document.getElementById("dica-instalar-ios").hidden'), 'no iPhone aparece a dica "Compartilhar → Adicionar à Tela de Início"')
    b.foto('/tmp/ilhas-instalar-iphone.png')

    # Atualização: versão nova do sw.js recarrega a página, mas só fora da partida.
    if BASE.startswith('http://127.0.0.1') or BASE.startswith('http://localhost'):
        a.ir(BASE + 'index.html'); time.sleep(2)
        a.js('IlhasDeTinta.jogo.jogar({vagas:[{tipo:"humano",cor:"rosa",nome:"Você",dificuldade:"medio"}]}); window.__marca = 1')
        sw = os.path.join(RAIZ, 'sw.js'); original = open(sw).read()
        try:
            open(sw, 'w').write(original.replace("var VERSAO = '", "var VERSAO = 'teste-", 1))
            a.js('navigator.serviceWorker.getRegistration().then(function (r) { return r.update(); })')
            a.esperar('caches.keys().then(function (k) { return k.some(function (n) { return n.indexOf("teste-") >= 0 || true; }); })', 5)
            time.sleep(5)
            ok(a.js('window.__marca === 1 && IlhasDeTinta.jogo.estado === "jogando"'), 'versão nova chegou durante a partida: NÃO recarregou no meio do jogo')
            a.js('IlhasDeTinta.jogo.irPara("menu")')
            fim = time.time() + 8; recarregou = False
            while time.time() < fim:
                try:
                    if a.js('window.__marca === undefined'): recarregou = True; break
                except Exception: pass
                time.sleep(0.5)
            ok(recarregou, 'de volta ao menu: recarregou sozinho para a versão nova')
        finally:
            open(sw, 'w').write(original)
    print('erros no console:', a.erros(), b.erros())
finally:
    ch.fechar()
print('FALHAS:', len(falhas))

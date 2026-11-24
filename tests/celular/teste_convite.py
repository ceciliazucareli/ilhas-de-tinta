"""Convite por link: o desktop cria a sala e toca em "Convidar"; o celular abre o
link (?sala=1234), já encontra o código preenchido e entra com um toque. Depois,
com o nome já lembrado no aparelho, abrir o link entra direto (sem tocar em nada).
Uso: python3 tests/celular/teste_convite.py [pasta_fotos]   (ILHAS_URL, padrão http://localhost:8000/)"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
S = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ilhas-de-tinta-testes'; os.makedirs(S, exist_ok=True)
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
falhas = []
def ok(c, t):
    print(('ok    ' if c else 'FALHA ') + t); sys.stdout.flush()
    if not c: falhas.append(t)

c1 = Chrome(9401, '/tmp/ilhas-perfil-conv1'); c2 = Chrome(9402, '/tmp/ilhas-perfil-conv2')
try:
    d = c1.nova_aba(); d.instalar_coletor_de_erros(); d.desktop(1280, 800); d.ir(URL)
    d.js('document.getElementById("botao-online").click(); document.getElementById("online-nome").value = "Davi"; document.getElementById("online-criar").click()')
    d.esperar('IlhasDeTinta.jogo.estado === "sala"', 15)
    codigo = d.js('document.getElementById("sala-codigo").textContent')
    d.js('document.getElementById("sala-convidar").click()'); time.sleep(0.8)
    aviso = d.js('document.getElementById("sala-aviso").textContent')
    link = d.js('IlhasDeTinta.online.linkDaSala(document.getElementById("sala-codigo").textContent)')
    ok(link.endswith('/?sala=' + codigo.split('-')[1]), 'link de convite: ' + link)
    ok(('copiado' in aviso) or (link in aviso), 'tocar em Convidar copia o link (ou mostra para mandar): "%s"' % aviso)
    d.foto(S + '/convite-sala-desktop.png')

    # O celular abre o link recebido.
    cel = c2.nova_aba(); cel.instalar_coletor_de_erros(); cel.celular(390, 844)
    cel.ir(URL); cel.js('localStorage.clear(); sessionStorage.clear()')  # aparelho "novo": sem nome lembrado
    cel.ir(URL.rsplit('/', 1)[0] + '/index.html?sala=' + codigo.split('-')[1]); time.sleep(0.8)
    ok(cel.js('IlhasDeTinta.jogo.estado') == 'online', 'o link abre direto a tela "Jogar Online"')
    ok(cel.js('document.getElementById("online-codigo").value') == codigo.split('-')[1], 'o código da sala já vem preenchido')
    print('      aviso no celular:', cel.js('document.getElementById("online-aviso").textContent'))
    cel.foto(S + '/convite-celular.png')
    r = json.loads(cel.js('JSON.stringify(document.getElementById("online-nome").getBoundingClientRect())'))
    cel.tocar(r['x'] + 20, r['y'] + 10); cel.cmd('Input.insertText', text='Lia')
    r = json.loads(cel.js('JSON.stringify(document.getElementById("online-entrar").getBoundingClientRect())'))
    cel.tocar(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)
    cel.esperar('IlhasDeTinta.jogo.estado === "sala"', 15)
    d.esperar('IlhasDeTinta.online.conexao().sala.membros.length === 2', 10)
    ok(True, 'com um toque em Entrar, o celular entrou na sala do desktop')
    # Nome lembrado: sai e abre o link de novo → entra direto.
    cel.js('IlhasDeTinta.online.sair("")'); time.sleep(1)
    cel.ir(URL.rsplit('/', 1)[0] + '/index.html?sala=' + codigo.split('-')[1])
    cel.esperar('IlhasDeTinta.jogo.estado === "sala"', 15)
    d.esperar('IlhasDeTinta.online.conexao().sala.membros.some(function(m){return m.nome === "Lia"})', 10)
    ok(True, 'com o nome lembrado (Lia), abrir o link de novo entra direto na sala')
    for a in (d, cel): ok(a.erros() == '[]', 'sem erros no console')
    d.js('IlhasDeTinta.online.sair("")'); cel.js('IlhasDeTinta.online.sair("")')
finally:
    c1.fechar(); c2.fechar()
print('FALHAS:', len(falhas))

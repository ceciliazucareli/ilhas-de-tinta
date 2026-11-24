"""Turma fixa, QR e nome lembrado, com aparelhos de verdade (Chrome headless + Supabase real).

Uso:  python3 tests/celular/teste_turma.py [pasta_fotos]
      (ILHAS_URL, padrão http://localhost:8000/index.html; precisa de internet)
      Com a pasta docs/screenshots, grava as fotos turma-*.png da documentação.

Confere:
  1. Ana (computador) cria a turma "Gatinhas" e vira a anfitriã; o QR da sala lê o link certo.
  2. Bia (celular, sem nome lembrado) abre o link: só escreve o nome e toca em Entrar.
  3. Duda (celular, nome e cor lembrados) abre o link e cai direto na sala, com a cor dela.
  4. Eva (computador, cor preferida ocupada) abre o link: entra direto com outra cor livre.
  5. Bia troca o nome na sala; a turma fica salva no aparelho dela ("Jogar com a turma …").
  6. Partida rolando: quem chega pelo link assiste (espectador).
  7. Todos saem; reabrir o link cria a sala de novo (quem abriu vira anfitriã).
  8. Duas pessoas abrem o link de uma turma vazia AO MESMO TEMPO: uma anfitriã só, mesma sala.
  9. O link da turma troca o manifest (start_url da turma) para "Adicionar à tela inicial".
"""
import os, sys, time, json, random, string
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
FOTOS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ilhas-de-tinta-testes'; os.makedirs(FOTOS, exist_ok=True)
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
BASE = URL.rsplit('/', 1)[0] + '/'
JSQR = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vendor', 'jsQR-1.4.0.js')).read()
falhas = []
def ok(c, t):
    print(('ok    ' if c else 'FALHA ') + t); sys.stdout.flush()
    if not c: falhas.append(t)

def limpar(a, nome=None, cor=None):
    """Começa do zero neste aparelho (e opcionalmente com nome/cor lembrados)."""
    a.ir(BASE + 'index.html')
    a.js('localStorage.clear(); sessionStorage.clear()')
    if nome: a.js('localStorage.setItem("ilhas-de-tinta:nome", %s)' % json.dumps(nome))
    if cor: a.js('localStorage.setItem("ilhas-de-tinta:cor", %s)' % json.dumps(cor))

def tocar(a, id_, seletor=None):
    alvo = 'document.querySelector(%s)' % json.dumps(seletor) if seletor else 'document.getElementById(%s)' % json.dumps(id_)
    r = json.loads(a.js('JSON.stringify(%s.getBoundingClientRect())' % alvo))
    a.tocar(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)

def sala(a): return json.loads(a.js('JSON.stringify(IlhasDeTinta.online.conexao() && IlhasDeTinta.online.conexao().sala)'))
def eu(a): return a.js('IlhasDeTinta.online.conexao().cid')
def membro(a, s=None):
    s = s or sala(a); c = eu(a)
    return [m for m in s['membros'] if m['cid'] == c][0]

chromes = [Chrome(9470 + i, '/tmp/ilhas-turma-%d' % i) for i in range(4)]
try:
    ana = chromes[0].nova_aba(); ana.instalar_coletor_de_erros(); ana.desktop(1100, 820)
    bia = chromes[1].nova_aba(); bia.instalar_coletor_de_erros(); bia.celular(390, 844)
    duda = chromes[2].nova_aba(); duda.instalar_coletor_de_erros(); duda.celular(390, 844)
    eva = chromes[3].nova_aba(); eva.instalar_coletor_de_erros(); eva.desktop(1000, 760)
    limpar(ana); limpar(bia); limpar(duda, 'Duda', 'roxo'); limpar(eva, 'Eva', 'rosa')

    # 1) Ana cria a turma.
    ana.ir(BASE + 'index.html')
    ana.js('document.getElementById("botao-online").click()'); time.sleep(0.4)
    ana.js('document.getElementById("online-nome").value = "Ana"; document.getElementById("online-criar-turma").click()'); time.sleep(0.4)
    ana.js('document.getElementById("online-turma-nome").value = "Gatinhas"')
    ana.foto(FOTOS + '/turma-criar.png')
    ana.js('document.getElementById("online-turma-confirmar").click()')
    ana.esperar('IlhasDeTinta.jogo.estado === "sala"', 20)
    s = sala(ana); turma = s['turma']['id']; link = ana.js('IlhasDeTinta.online.linkDoConvite()')
    ok(s['anfitriao'] == eu(ana) and s['turma']['nome'] == 'Gatinhas', 'Ana criou a turma e é a anfitriã: ' + turma)
    ok(link == BASE + '?turma=' + turma, 'link fixo da turma: ' + link)
    ok(ana.js('document.getElementById("sala-convidar").textContent').startswith('🔗 Mandar link da turma'), 'botão "Mandar link da turma"')
    ana.js('document.getElementById("sala-convidar").click()'); time.sleep(0.6)
    print('      aviso:', ana.js('document.getElementById("sala-aviso").textContent'))
    ana.js('document.getElementById("sala-qr").click()'); time.sleep(0.6)
    ana.js(JSQR + ';0')
    lido = ana.js('''(function(){var c=document.getElementById("qr-canvas"),x=c.getContext("2d").getImageData(0,0,c.width,c.height);
        var r=jsQR(x.data,c.width,c.height);return r?r.data:null;})()''')
    ok(lido == link, 'QR na tela (lido com jsQR) = link da turma: %s' % lido)
    ana.foto(FOTOS + '/turma-qr-computador.png')
    ana.js('document.getElementById("qr-fechar").click()')

    # 2) Bia: celular sem nome lembrado.
    bia.ir(link); time.sleep(1.0)
    ok(bia.js('IlhasDeTinta.jogo.estado') == 'online' and not bia.js('document.getElementById("online-convite").hidden'), 'Bia (sem nome): tela pede só o nome')
    print('      convite:', bia.js('document.getElementById("online-convite").textContent'))
    tocar(bia, 'online-nome'); bia.cmd('Input.insertText', text='Bia')
    bia.foto(FOTOS + '/turma-convite-celular.png')
    tocar(bia, 'online-entrar-convite')
    bia.esperar('IlhasDeTinta.jogo.estado === "sala"', 20)
    ana.esperar('IlhasDeTinta.online.conexao().sala.membros.length === 2', 15)
    ok(sala(bia)['anfitriao'] == eu(ana), 'Bia entrou na MESMA sala (anfitriã Ana) com um toque')

    # 3) Duda: nome e cor lembrados → direto na sala.
    t0 = time.time(); duda.ir(link)
    duda.esperar('IlhasDeTinta.jogo.estado === "sala" && !!IlhasDeTinta.online.conexao().sala', 20)
    ok(True, 'Duda (nome lembrado) caiu direto na sala, sem tocar em nada (%.1f s)' % (time.time() - t0))
    ana.esperar('IlhasDeTinta.online.conexao().sala.membros.length === 3', 15)
    time.sleep(0.8)
    ok(membro(duda)['cor'] == 'roxo' and membro(duda)['nome'] == 'Duda', 'Duda ficou com a cor preferida (roxo)')
    duda.js('document.getElementById("sala-qr").click()'); time.sleep(0.7)
    duda.foto(FOTOS + '/turma-qr-celular.png')
    duda.js('document.getElementById("qr-fechar").click()')

    # 4) Eva: cor preferida (rosa) ocupada pela Ana → outra livre.
    eva.ir(link)
    eva.esperar('IlhasDeTinta.jogo.estado === "sala" && !!IlhasDeTinta.online.conexao().sala', 20)
    ana.esperar('IlhasDeTinta.online.conexao().sala.membros.length === 4', 15)
    time.sleep(0.8)
    cores = sorted(m['cor'] for m in sala(ana)['membros'])
    ok(membro(eva)['cor'] not in ('rosa', 'roxo') and len(set(cores)) == 4, 'Eva: rosa ocupada, ganhou outra livre (%s); cores %s' % (membro(eva)['cor'], cores))
    duda.foto(FOTOS + '/turma-sala-celular.png')
    ana.foto(FOTOS + '/turma-sala-computador.png')

    # 5) Bia troca o nome; turma salva no aparelho.
    bia.js('document.getElementById("sala-trocar-nome").click()'); time.sleep(0.3)
    bia.js('document.getElementById("sala-novo-nome").value = "Bibi"; document.getElementById("sala-salvar-nome").click()')
    ana.esperar('IlhasDeTinta.online.conexao().sala.membros.some(function(m){return m.nome === "Bibi"})', 10)
    ok(bia.js('localStorage.getItem("ilhas-de-tinta:nome")') == 'Bibi', 'Bia trocou o nome para Bibi (todos veem; fica lembrado)')

    # 6) Partida rolando: quem chega assiste. (Eva sai e volta durante a partida.)
    eva.js('IlhasDeTinta.online.sair("")'); time.sleep(1.5)
    ana.js('document.getElementById("sala-jogar").click()')
    for a in (ana, bia, duda): a.esperar('IlhasDeTinta.jogo.estado === "jogando"', 15)
    eva.ir(link)
    eva.esperar('IlhasDeTinta.jogo.estado === "jogando"', 25)
    ok(eva.js('!!IlhasDeTinta.online.conexao().espectador'), 'Eva chegou pelo link no meio da partida: assiste (espectadora)')

    # 7) Todos saem; reabrir o link cria a sala de novo.
    for a in (ana, bia, duda, eva): a.js('IlhasDeTinta.online.sair("")')
    time.sleep(3)
    bia.ir(BASE + 'index.html'); time.sleep(0.6)
    bia.js('document.getElementById("botao-online").click()'); time.sleep(0.6)
    botoes = bia.js('[].map.call(document.querySelectorAll("#online-lista-turmas .botao-turma"), function(b){return b.textContent}).join("|")')
    ok('Jogar com a turma Gatinhas' in botoes, 'turma salva no menu Online da Bia: "%s"' % botoes)
    bia.foto(FOTOS + '/turma-menu-celular.png')
    duda.ir(link)
    duda.esperar('IlhasDeTinta.jogo.estado === "sala" && !!IlhasDeTinta.online.conexao().sala', 30)
    ok(sala(duda)['anfitriao'] == eu(duda) and len(sala(duda)['membros']) == 1, 'todo mundo saiu; Duda reabriu o link e virou a anfitriã da sala nova')
    tocar(bia, None, '#online-lista-turmas .botao-turma')  # o primeiro botão da lista
    bia.esperar('IlhasDeTinta.jogo.estado === "sala" && !!IlhasDeTinta.online.conexao().sala', 20)
    ok(sala(bia)['anfitriao'] == eu(duda), 'Bia tocou em "Jogar com a turma Gatinhas" e entrou na sala da Duda')
    for a in (duda, bia): a.js('IlhasDeTinta.online.sair("")')

    # 8) Turma vazia, duas pessoas ao mesmo tempo.
    nova = 'corrida-' + ''.join(random.choice('23456789abcdefghjkmnpqrstuvwxyz') for _ in range(5))
    for a, n in ((ana, 'Ana'), (eva, 'Eva')): limpar(a, n)
    for a in (ana, eva): a.cmd('Page.navigate', url=BASE + '?turma=' + nova)
    for a in (ana, eva): a.esperar('!!(window.IlhasDeTinta && IlhasDeTinta.online && IlhasDeTinta.online.conexao() && IlhasDeTinta.online.conexao().sala)', 30)
    time.sleep(3)
    sa, se = sala(ana), sala(eva)
    anfitrias = [a for a in (ana, eva) if a.js('IlhasDeTinta.online.conexao().anfitriao')]
    ok(len(anfitrias) == 1 and sa['anfitriao'] == se['anfitriao'] and len(sa['membros']) == 2, 'abriram juntas uma turma vazia: 1 anfitriã, mesma sala (%d membros)' % len(sa['membros']))
    for a in (ana, eva): a.js('IlhasDeTinta.online.sair("")')

    # 9) Manifest da turma (Adicionar à tela inicial abre direto nela).
    m = duda.cmd('Page.getAppManifest')
    dados = json.loads(m.get('data') or '{}') if m.get('data') else {}
    print('      manifest:', m.get('url', '')[:60], dados.get('start_url'), dados.get('name'), m.get('errors'))
    ok(dados.get('start_url', '').endswith('?turma=' + turma), 'manifest da página da turma: start_url = link da turma')

    for a, n in ((ana, 'Ana'), (bia, 'Bia'), (duda, 'Duda'), (eva, 'Eva')):
        ok(a.erros() == '[]', 'sem erros no console (%s): %s' % (n, a.erros()))
finally:
    for ch in chromes: ch.fechar()
print('\n' + ('TUDO OK' if not falhas else '%d FALHA(S): %s' % (len(falhas), '; '.join(falhas))))
sys.exit(1 if falhas else 0)

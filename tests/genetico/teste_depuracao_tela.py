"""Testa o modo depuração oculto no Chrome de verdade e tira as fotos de tela.

Uso:  python3 tests/genetico/teste_depuracao_tela.py [url-base] [--fotos]
      (padrão http://localhost:8000/; --fotos grava docs/screenshots/debug-*.png)

Confere:
  - sem ?debug=1 nada aparece (nem painel, nem registro);
  - ?robo=campeao&debug=1: painel com linhas, balão/desenhos, sem erros no console;
  - o log explica uma fuga por perigo, uma caçada e a escolha de uma volta;
  - pausa, "passo" (exatamente uma decisão), linha aberta com ranking e foto;
  - &cenario=3j e ?debug=1 sem robô (segue a CPU Impossível);
  - celular: painel embaixo, recolhível.
"""
import os, sys, time, json
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', 'celular')); from cdp import Chrome
args = [a for a in sys.argv[1:] if not a.startswith('--')]
BASE = (args[0] if args else 'http://localhost:8000/').rstrip('/') + '/'
FOTOS = '--fotos' in sys.argv
PASTA_FOTOS = os.path.join(AQUI, '..', '..', 'docs', 'screenshots')
falhas = []

def checar(cond, texto):
    print(('ok   ' if cond else 'FALHA ') + texto)
    if not cond: falhas.append(texto)

REG = 'IlhasDeTinta.depuracaoTela.registro()'

def esperar_e_pausar(a, cond, limite=40):
    """Espera a condição (sobre o registro) e pausa NA MESMA hora (sem corrida)."""
    expr = '(function(){var r=%s; if(!r||!r.atual) return false; var a=r.atual, d=a.desenhos; if(%s){IlhasDeTinta.depuracaoTela.velocidade(0); return true;} return false;})()' % (REG, cond)
    a.esperar(expr, limite, 0.03)
    time.sleep(0.3)  # deixa desenhar o quadro pausado

ch = Chrome(9488, '/tmp/claude-1001/depuracao-chr')
try:
    a = ch.nova_aba(); a.instalar_coletor_de_erros(); a.desktop(1280, 800)

    # 1) Sem debug: nada muda.
    a.ir(BASE + 'index.html?robo=campeao'); time.sleep(2)
    checar(a.js('!document.getElementById("depuracao") && !IlhasDeTinta.depuracao'), 'sem debug=1: sem painel e sem registro')
    a.ir(BASE + 'index.html'); time.sleep(1)
    checar(a.js('!document.getElementById("depuracao") && !IlhasDeTinta.depuracao && IlhasDeTinta.jogo.escalaTempo === undefined'), 'jogo normal: nada de depuração')

    # 2) Robô campeão com depuração.
    a.ir(BASE + 'index.html?robo=campeao&debug=1')
    a.esperar('!!(IlhasDeTinta.depuracaoTela && %s && %s.entradas.length > 3)' % (REG, REG), 20)
    esperar_e_pausar(a, 'a.modo === "sair" && d.plano && a.numeros.rastro >= 4 && a.numeros.rastro <= 9')
    if FOTOS: a.foto(os.path.join(PASTA_FOTOS, 'debug-volta.png'))
    a.js('IlhasDeTinta.depuracaoTela.velocidade(1)')
    esperar_e_pausar(a, 'a.modo === "voltar" && a.motivo === "perigo" && d.perigo && d.perigo.length > 5 && d.caminhoCasa && d.caminhoCasa.length > 2')
    checar(True, 'apareceu uma fuga por perigo com área de perigo e caminho de casa')
    if FOTOS: a.foto(os.path.join(PASTA_FOTOS, 'debug-balao-perigo.png'))
    frase = a.js('%s.atual.frase' % REG)
    print('     balão:', frase)
    checar('chega no meu rastro em' in frase, 'balão explica a fuga com os números')
    a.js('IlhasDeTinta.depuracaoTela.velocidade(1)')
    esperar_e_pausar(a, 'a.modo === "cacar" && d.mira', 60)
    checar(True, 'apareceu uma caçada com mira')
    if FOTOS: a.foto(os.path.join(PASTA_FOTOS, 'debug-cacada.png'))
    print('     balão:', a.js('%s.atual.frase' % REG))

    # Passo: exatamente uma decisão a mais.
    antes = a.js('%s.decisoes' % REG)
    a.js('document.querySelector("#depuracao [data-acao=passo]").click()')
    depois = a.js('%s.decisoes' % REG)
    checar(depois == antes + 1, 'botão ⏭ passo avança uma decisão (%s → %s)' % (antes, depois))
    t0 = a.js('IlhasDeTinta.jogo.ultimoTempo'); time.sleep(0.5)
    checar(a.js('IlhasDeTinta.jogo.ultimoTempo') == t0, 'pausado: o tempo do jogo não anda')

    # Linha de volta aberta: ranking + foto.
    a.js('''(function(){var lis=[].slice.call(document.querySelectorAll("#depuracao li.decisao"));
      var li=lis.filter(function(l){return l.entrada.motivo==="volta" && l.entrada.candidatos && l.entrada.candidatos.length>3;}).slice(-1)[0];
      li.scrollIntoView({block:"center"}); li.querySelector(".dep-linha").click();})()''')
    time.sleep(0.4)
    linhas_tabela = a.js('document.querySelectorAll("#depuracao li.aberta table tr").length')
    checar(linhas_tabela >= 4, 'linha aberta mostra o ranking das voltas (%s linhas)' % linhas_tabela)
    checar(a.js('!document.querySelector("#depuracao [data-acao=vivo]").hidden'), 'linha aberta mostra a foto daquele momento (botão Ao vivo)')
    if FOTOS: a.foto(os.path.join(PASTA_FOTOS, 'debug-painel-ranking.png'))
    a.js('document.querySelector("#depuracao [data-acao=vivo]").click()')

    log = json.loads(a.js('JSON.stringify(%s.exportar())' % REG))
    motivos = set(e.get('motivo') for e in log['entradas'])
    checar({'perigo', 'corte', 'volta'} <= motivos, 'log JSON tem perigo, corte e volta (%s)' % sorted(m for m in motivos if m))
    exemplos = {}
    for e in log['entradas']:
        k = e.get('motivo') or e.get('evento')
        if k in ('perigo', 'corte', 'volta', 'vigia', 'cortei', 'pintou', 'cortado') and k not in exemplos: exemplos[k] = '%5.1f s  %s' % (e['t'], e['frase'])
    for k, v in exemplos.items(): print('     exemplo %-8s %s' % (k, v))
    checar(a.erros() == '[]', 'sem erros no console: ' + a.erros())

    # 3) 3 jogadores.
    a.ir(BASE + 'index.html?robo=campeao&cenario=3j&debug=1')
    a.esperar('!!(IlhasDeTinta.depuracaoTela && %s && %s.entradas.length > 5)' % (REG, REG), 20)
    time.sleep(3)
    checar(a.js('%s.sujeito.nome' % REG) == 'Robô campeão' and a.js('IlhasDeTinta.jogo.jogadores.length') == 3, '3j: registra o robô campeão com 3 jogadores')
    checar(a.erros() == '[]', '3j sem erros: ' + a.erros())

    # 4) Só ?debug=1: segue a CPU Impossível numa partida comum.
    a.ir(BASE + 'index.html?debug=1'); time.sleep(1)
    a.js('IlhasDeTinta.jogo.jogar({vagas:[{tipo:"humano",cor:"rosa",nome:"Ana"},{tipo:"cpu",cor:"azul",nome:"CPU Impossível",dificuldade:"desafio"}]})')
    a.esperar('!!(IlhasDeTinta.depuracaoTela.registro() && %s.entradas.length > 1)' % REG, 20)
    checar(a.js('%s.sujeito.nome' % REG) == 'CPU Impossível', '?debug=1 sem robô: segue a CPU Impossível')
    time.sleep(4)
    print('     Impossível:', a.js('%s.atual.frase' % REG))
    checar(a.erros() == '[]', 'debug com CPU sem erros: ' + a.erros())

    # 5) Celular: painel embaixo, recolhível.
    b = ch.nova_aba(); b.instalar_coletor_de_erros(); b.celular(390, 844)
    b.ir(BASE + 'index.html?robo=campeao&debug=1')
    b.esperar('!!(IlhasDeTinta.depuracaoTela && %s && %s.entradas.length > 3)' % (REG, REG), 20)
    checar(b.js('document.getElementById("depuracao").classList.contains("recolhido")'), 'celular: painel começa recolhido')
    esperar_e_pausar(b, 'a.modo === "voltar" && d.caminhoCasa && d.caminhoCasa.length > 2 && d.perigo && d.perigo.length > 3')
    if FOTOS: b.foto(os.path.join(PASTA_FOTOS, 'debug-celular-recolhido.png'))
    b.js('document.querySelector("#depuracao .dep-titulo").click()'); time.sleep(0.4)
    alt = b.js('Math.round(document.getElementById("depuracao").getBoundingClientRect().height)')
    checar(alt > 250, 'celular: painel abre embaixo (%s px)' % alt)
    if FOTOS: b.foto(os.path.join(PASTA_FOTOS, 'debug-celular.png'))
    checar(b.erros() == '[]', 'celular sem erros: ' + b.erros())
finally:
    ch.fechar()

print('\n' + ('TUDO OK' if not falhas else '%d FALHA(S): %s' % (len(falhas), '; '.join(falhas))))
sys.exit(1 if falhas else 0)

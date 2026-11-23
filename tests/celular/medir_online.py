"""Mede o online de verdade (Supabase): mensagens por partida (issue #5) e atraso da virada (issue #7).

Uso:  python3 tests/celular/medir_online.py [jogadores] [segundos]
      (ILHAS_URL, padrão http://localhost:8000/index.html; precisa de internet)

Cada jogador é um Chrome separado. Todos apertam setas como uma pessoa (uma
virada a cada ~0,6–1,2 s). No fim, soma de todos os aparelhos:
  - mensagens ENVIADAS e RECEBIDAS por tipo (o Supabase cobra 1 por envio + 1 por
    aparelho que recebe) e bytes;
  - viradas: quanto tempo até aparecer na tela de quem virou (previsão) e quanto
    tempo até o anfitrião confirmar (o que era o atraso antes), correções, e
    quantas viradas teriam saído uma célula atrasada no modelo antigo.
"""
import os, sys, time, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
N = int(sys.argv[1]) if len(sys.argv) > 1 else 2
SEGUNDOS = int(sys.argv[2]) if len(sys.argv) > 2 else 120
NOMES = ['Ana', 'Beto', 'Caio', 'Duda']
TECLAS = [('ArrowUp', 'ArrowUp'), ('ArrowDown', 'ArrowDown'), ('ArrowLeft', 'ArrowLeft'), ('ArrowRight', 'ArrowRight')]

chromes = [Chrome(9460 + i, '/tmp/medir-%d' % i) for i in range(N)]
try:
    abas = []
    for i, ch in enumerate(chromes):
        a = ch.nova_aba(); a.instalar_coletor_de_erros(); a.desktop(900, 700); a.ir(URL); abas.append(a)
    h = abas[0]
    h.js('IlhasDeTinta.config.TEMPO_LIMITE = %d; document.getElementById("botao-online").click(); document.getElementById("online-nome").value="Ana"; document.getElementById("online-criar").click()' % SEGUNDOS)
    h.esperar('IlhasDeTinta.jogo.estado === "sala"', 25)
    codigo = h.js('document.getElementById("sala-codigo").textContent').split('-')[1]
    for i in range(1, N):
        abas[i].js('document.getElementById("botao-online").click(); document.getElementById("online-nome").value="%s"; document.getElementById("online-codigo").value="%s"; document.getElementById("online-entrar").click()' % (NOMES[i], codigo))
    h.esperar('IlhasDeTinta.online.conexao().sala.membros.length === %d' % N, 30)
    for a in abas: a.js('IlhasDeTinta.online.zerarContagem()')
    h.js('document.getElementById("sala-jogar").click()')
    for a in abas: a.esperar('IlhasDeTinta.jogo.estado === "jogando"', 15)
    inicio = time.time()
    proxima = [time.time() + random.uniform(0.3, 1.0) for _ in abas]
    while time.time() - inicio < SEGUNDOS + 20:
        if all(a.js('IlhasDeTinta.jogo.estado') == 'fim' for a in abas): break
        agora = time.time()
        for i, a in enumerate(abas):
            if agora >= proxima[i]:
                codigo_t, chave = random.choice(TECLAS)
                a.cmd('Input.dispatchKeyEvent', type='rawKeyDown', code=codigo_t, key=chave, windowsVirtualKeyCode=0)
                a.cmd('Input.dispatchKeyEvent', type='keyUp', code=codigo_t, key=chave)
                proxima[i] = agora + random.uniform(0.6, 1.2)
        time.sleep(0.05)
    duracao = time.time() - inicio
    time.sleep(1.5)

    enviadas, recebidas, bytesE, bytesR = {}, {}, 0, 0
    for a in abas:
        c = json.loads(a.js('JSON.stringify(IlhasDeTinta.online.contagem())'))
        for k, v in c['enviadas'].items(): enviadas[k] = enviadas.get(k, 0) + v
        for k, v in c['recebidas'].items(): recebidas[k] = recebidas.get(k, 0) + v
        bytesE += c['bytesEnviados']; bytesR += c['bytesRecebidos']
    totalE, totalR = sum(enviadas.values()), sum(recebidas.values())
    print('== %d jogadores, partida de %.0f s' % (N, duracao))
    print('enviadas por tipo :', json.dumps(dict(sorted(enviadas.items(), key=lambda x: -x[1]))))
    print('recebidas por tipo:', json.dumps(dict(sorted(recebidas.items(), key=lambda x: -x[1]))))
    print('TOTAL que o Supabase conta (envios + recebimentos): %d mensagens (%.1f por segundo)' % (totalE + totalR, (totalE + totalR) / duracao))
    print('bytes: enviados %.0f KB, recebidos %.0f KB; média por mensagem enviada %.0f bytes' % (bytesE / 1024, bytesR / 1024, bytesE / max(1, totalE)))

    medidas = [json.loads(a.js('JSON.stringify(IlhasDeTinta.online.medidasVirada())')) for a in abas]
    anf = medidas[0]['anfitriao']
    cli = {'pedidas': 0, 'mostrada': [], 'confirmou': [], 'correcoes': 0, 'mantidas': 0}
    for m in medidas[1:]:
        cm = m['cliente']
        cli['pedidas'] += cm['pedidas']; cli['mostrada'] += cm['mostradaNaHoraMs']; cli['confirmou'] += cm['anfitriaoConfirmouMs']
        cli['correcoes'] += cm['correcoes']; cli['mantidas'] += cm['mantidas']
    def media(l): return sum(l) / len(l) if l else 0
    def p90(l): return sorted(l)[int(len(l) * 0.9)] if l else 0
    total_v = anf['exatas'] + anf['rebobinadas'] + anf['atrasadas']
    print('VIRADAS dos clientes: %d' % cli['pedidas'])
    print('  aparece na tela de quem virou: média %.0f ms (p90 %.0f ms) — inclui andar até a célula da virada' % (media(cli['mostrada']), p90(cli['mostrada'])))
    print('  anfitrião confirma (o atraso de antes): média %.0f ms (p90 %.0f ms)' % (media(cli['confirmou']), p90(cli['confirmou'])))
    print('  no anfitrião: %d na célula certa ao chegar, %d rebobinadas para a célula certa, %d atrasadas' % (anf['exatas'], anf['rebobinadas'], anf['atrasadas']))
    print('  modelo antigo: %d de %d (%.0f%%) teriam virado uma célula depois' % (anf['antigoAtrasaria'], total_v, 100.0 * anf['antigoAtrasaria'] / max(1, total_v)))
    print('  previsão: %d estados mantidos, %d correções (deslizando)' % (cli['mantidas'], cli['correcoes']))
    for a, nome in zip(abas, NOMES):
        e = a.erros()
        if e != '[]': print('ERROS no console (%s): %s' % (nome, e))
    print(json.dumps({'jogadores': N, 'segundos': round(duracao), 'enviadas': totalE, 'recebidas': totalR,
                      'total': totalE + totalR, 'porSegundo': round((totalE + totalR) / duracao, 1),
                      'bytesEnviados': bytesE, 'viradas': {'mostradaMs': round(media(cli['mostrada'])), 'confirmadaMs': round(media(cli['confirmou'])),
                      'antigoAtrasaria': anf['antigoAtrasaria'], 'total': total_v, 'atrasadasAgora': anf['atrasadas'], 'correcoes': cli['correcoes']}}))
finally:
    for ch in chromes: ch.fechar()

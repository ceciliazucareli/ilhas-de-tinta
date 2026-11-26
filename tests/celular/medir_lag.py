"""Mede o "lag" de quem NÃO é o anfitrião numa partida online de verdade (Supabase real).

Uso:  python3 tests/celular/medir_lag.py [atraso_ms] [variacao_ms] [cpu_lenta] [segundos]
      ex.: python3 tests/celular/medir_lag.py 80 60 4 35
      (ILHAS_URL, padrão http://localhost:8000/index.html; LAG_FOTOS=pasta tira fotos dos dois)

- Dois Chromes: anfitrião (computador) e cliente (celular emulado; cpu_lenta = quantas
  vezes mais lento, como um celular simples).
- atraso_ms/variacao_ms: atraso EXTRA em cada mensagem do WebSocket (nos dois aparelhos,
  em cada sentido), com variação aleatória mantendo a ordem — como Wi-Fi de casa/4G.
- Os dois "apertam setas" como uma pessoa (uma virada a cada 0,4–1,0 s).
- A cada ~50 ms lê onde cada explorador está DE VERDADE (no anfitrião) e onde ele
  APARECE no cliente, no mesmo instante. Mede:
    outro  = o explorador do anfitrião visto no cliente: erro médio/p95/máx (células)
             e "corrida": quanto ele aparece à frente do lugar certo (passou da curva);
    meu    = o explorador do cliente: erro, e "puxões" (voltou para trás de repente).
"""
import os, sys, time, json, random, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from cdp import Chrome
URL = os.environ.get('ILHAS_URL', 'http://localhost:8000/index.html')
ATRASO = int(sys.argv[1]) if len(sys.argv) > 1 else 0
VARIACAO = int(sys.argv[2]) if len(sys.argv) > 2 else 0
CPU = float(sys.argv[3]) if len(sys.argv) > 3 else 1
SEGUNDOS = int(sys.argv[4]) if len(sys.argv) > 4 else 40

ATRASAR_WS = '''(function(){ var A = %d, V = %d; if (!A && !V) return; var W = window.WebSocket;
  function atrasado(){ var ultimo = 0; return function (f) { var t = Math.max(ultimo, performance.now() + A + Math.random() * V); ultimo = t;
    setTimeout(f, t - performance.now()); }; }
  window.WebSocket = function (u, p) {
    var s = p ? new W(u, p) : new W(u), chega = atrasado(), sai = atrasado(), enviar = s.send.bind(s), h = null;
    s.send = function (d) { sai(function () { if (s.readyState === 1) enviar(d); }); };
    Object.defineProperty(s, 'onmessage', { get: function () { return h; }, set: function (f) { h = f; } });
    W.prototype.addEventListener.call(s, 'message', function (ev) { chega(function () { if (h) h.call(s, ev); }); });
    return s; };
  window.WebSocket.prototype = W.prototype; ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){ window.WebSocket[k] = W[k]; });
})();''' % (ATRASO, VARIACAO)

LER = '''JSON.stringify({t: Date.now(), e: IlhasDeTinta.jogo.estado, j: IlhasDeTinta.jogo.jogadores.map(function (j) {
  var p = j.explorador.posicaoVisual(), e = j.explorador, g = IlhasDeTinta.jogo.grade;
  // [3]: a célula onde ele está (fora de casa, andando) já mostra o rastro dele?
  var semRastro = e.direcao && g.dono(e.x, e.y) !== j.id && g.rastro(e.x, e.y) !== j.id ? 1 : 0;
  return [p.x, p.y, e.direcao, semRastro]; })})'''
TECLAS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

def apertar(a, tecla):
    a.cmd('Input.dispatchKeyEvent', type='rawKeyDown', code=tecla, key=tecla, windowsVirtualKeyCode=0)
    a.cmd('Input.dispatchKeyEvent', type='keyUp', code=tecla, key=tecla)

def p(lista, q):
    if not lista: return 0
    s = sorted(lista); return s[min(len(s) - 1, int(len(s) * q))]

ch = [Chrome(9450, '/tmp/lag-h'), Chrome(9451, '/tmp/lag-c')]
try:
    h = ch[0].nova_aba(); c = ch[1].nova_aba()
    for a in (h, c):
        a.instalar_coletor_de_erros()
        a.cmd('Page.addScriptToEvaluateOnNewDocument', source=ATRASAR_WS)
    h.desktop(1000, 760); c.celular(390, 844)
    if CPU > 1: c.cmd('Emulation.setCPUThrottlingRate', rate=CPU)
    for a in (h, c): a.ir(URL); a.js('localStorage.clear(); sessionStorage.clear()')
    for a in (h, c): a.ir(URL)
    h.js('IlhasDeTinta.config.TEMPO_LIMITE = %d; document.getElementById("botao-online").click(); document.getElementById("online-nome").value="Ana"; document.getElementById("online-criar").click()' % SEGUNDOS)
    h.esperar('IlhasDeTinta.jogo.estado === "sala"', 30)
    codigo = h.js('document.getElementById("sala-codigo").textContent').split('-')[1]
    c.js('document.getElementById("botao-online").click(); document.getElementById("online-nome").value="Bia"; document.getElementById("online-codigo").value="%s"; document.getElementById("online-entrar").click()' % codigo)
    h.esperar('IlhasDeTinta.online.conexao().sala.membros.length === 2', 30)
    time.sleep(1)
    h.js('document.getElementById("sala-jogar").click()')
    for a in (h, c): a.esperar('IlhasDeTinta.jogo.estado === "jogando"', 20)
    c.js('IlhasDeTinta.online.zerarContagem()')
    idx = {nome: i for i, nome in enumerate(json.loads(h.js('JSON.stringify(IlhasDeTinta.jogo.jogadores.map(function(j){return j.nome}))')))}
    iA, iB = idx['Ana'], idx['Bia']
    amostrasH, amostrasC = [], []
    proxima = [time.time() + 0.5, time.time() + 0.7]
    inicio = time.time()
    while time.time() - inicio < SEGUNDOS - 3:
        agora = time.time()
        for k, a in enumerate((h, c)):
            if agora >= proxima[k]:
                apertar(a, random.choice(TECLAS)); proxima[k] = agora + random.uniform(0.4, 1.0)
        if os.environ.get('LAG_FOTOS') and len(amostrasC) in (150, 300, 450):
            c.foto(os.path.join(os.environ['LAG_FOTOS'], 'lag-cliente-%d.png' % len(amostrasC)))
            h.foto(os.path.join(os.environ['LAG_FOTOS'], 'lag-anfitriao-%d.png' % len(amostrasC)))
        amostrasH.append(json.loads(h.js(LER)))
        amostrasC.append(json.loads(c.js(LER)))
        time.sleep(0.02)
    medidas = json.loads(c.js('JSON.stringify(IlhasDeTinta.online.medidasVirada().cliente)'))
    noAnfitriao = json.loads(h.js('JSON.stringify(IlhasDeTinta.online.medidasVirada().anfitriao)'))
    diretas = json.loads(c.js('JSON.stringify(IlhasDeTinta.online.medidasVirada().diretas || null)'))
    erros = (h.erros(), c.erros())
finally:
    for x in ch: x.fechar()

# Verdade (anfitrião) interpolada no instante de cada amostra do cliente.
def verdade(t, i):
    for k in range(1, len(amostrasH)):
        a, b = amostrasH[k - 1], amostrasH[k]
        if a['t'] <= t <= b['t'] and b['t'] > a['t']:
            f = (t - a['t']) / (b['t'] - a['t'])
            pa, pb = a['j'][i], b['j'][i]
            if abs(pa[0] - pb[0]) + abs(pa[1] - pb[1]) > 3: return pb[:2], pb[2]  # renasceu/teleporte
            return [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f], pb[2]
    return None, None

def viradas_de_verdade(i):
    ts, ant = [], None
    for a in amostrasH:
        d = a['j'][i][2]
        if ant and d and d != ant: ts.append(a['t'])
        if d: ant = d
    return ts

def analisar(i):
    erros_, corrida, puxoes, ant = [], [], 0, None
    curvas, tv = [], viradas_de_verdade(i)
    for s in amostrasC:
        if s['e'] != 'jogando': continue
        v, d = verdade(s['t'], i)
        if v is None: continue
        q = s['j'][i]
        erros_.append(abs(q[0] - v[0]) + abs(q[1] - v[1]))
        if any(0 <= s['t'] - t0 <= 600 for t0 in tv): curvas.append(erros_[-1])
        # "corrida": distância à frente da verdade na direção que o cliente mostra
        if q[2]:
            dx, dy = {'cima': (0, -1), 'baixo': (0, 1), 'esquerda': (-1, 0), 'direita': (1, 0)}[q[2]]
            corrida.append(max(0, (q[0] - v[0]) * dx + (q[1] - v[1]) * dy))
        if ant and q[2]:
            dx, dy = {'cima': (0, -1), 'baixo': (0, 1), 'esquerda': (-1, 0), 'direita': (1, 0)}[q[2]]
            if (q[0] - ant[0]) * dx + (q[1] - ant[1]) * dy < -0.3: puxoes += 1
        ant = q
    n = max(1, len(erros_))
    return {'erro_medio': round(sum(erros_) / n, 2), 'erro_p95': round(p(erros_, 0.95), 2), 'erro_max': round(max(erros_ or [0]), 2),
            'acima_1_5': round(100.0 * sum(1 for e in erros_ if e > 1.5) / n, 1),
            'erro_nas_curvas': round(sum(curvas) / max(1, len(curvas)), 2), 'erro_nas_curvas_p95': round(p(curvas, 0.95), 2),
            'corrida_p95': round(p(corrida, 0.95), 2), 'corrida_max': round(max(corrida or [0]), 2), 'puxoes': puxoes, 'amostras': n}

r = {'atraso_ms': ATRASO, 'variacao_ms': VARIACAO, 'cpu_lenta': CPU,
     'outro_visto_no_cliente': analisar(iA), 'meu_no_cliente': analisar(iB),
     'meu_rastro_atrasado_pct': round(100.0 * sum(s['j'][iB][3] for s in amostrasC if s['e'] == 'jogando') / max(1, sum(1 for s in amostrasC if s['e'] == 'jogando' and s['j'][iB][2])), 1),
     'viradas': {'pedidas': medidas['pedidas'], 'correcoes': medidas['correcoes'], 'mantidas': medidas['mantidas'],
                 'confirmacao_ms_media': round(sum(medidas['anfitriaoConfirmouMs']) / max(1, len(medidas['anfitriaoConfirmouMs']))),
                 'no_anfitriao': {k: noAnfitriao.get(k) for k in ('exatas', 'rebobinadas', 'agendadas', 'atrasadas')},
                 'diretas_no_cliente': diretas},
     'erros_console': erros}
print(json.dumps(r, ensure_ascii=False))

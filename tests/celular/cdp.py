# Cliente CDP mínimo (só biblioteca padrão) para testar o jogo no Chrome headless em tempo real.
import base64, json, os, socket, struct, subprocess, time, urllib.request

class Aba:
    def __init__(self, ws_url):
        host_port, caminho = ws_url[len('ws://'):].split('/', 1)
        host, porta = host_port.split(':')
        self.s = socket.create_connection((host, int(porta)))
        chave = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (caminho, host_port, chave)).encode())
        resp = b''
        while b'\r\n\r\n' not in resp: resp += self.s.recv(1)
        assert b' 101 ' in resp, resp
        self.n = 0
        self.eventos = []

    def _enviar(self, texto):
        dados = texto.encode()
        cab = bytearray([0x81])
        n = len(dados)
        if n < 126: cab.append(0x80 | n)
        elif n < 65536: cab.append(0x80 | 126); cab += struct.pack('>H', n)
        else: cab.append(0x80 | 127); cab += struct.pack('>Q', n)
        masc = os.urandom(4); cab += masc
        self.s.sendall(bytes(cab) + bytes(b ^ masc[i % 4] for i, b in enumerate(dados)))

    def _ler_exato(self, n):
        buf = b''
        while len(buf) < n:
            parte = self.s.recv(n - len(buf))
            if not parte: raise IOError('conexão fechada')
            buf += parte
        return buf

    def _receber(self):
        msg = b''
        while True:
            b1, b2 = self._ler_exato(2)
            n = b2 & 0x7f
            if n == 126: n = struct.unpack('>H', self._ler_exato(2))[0]
            elif n == 127: n = struct.unpack('>Q', self._ler_exato(8))[0]
            msg += self._ler_exato(n)
            if b1 & 0x80: return json.loads(msg.decode())

    def cmd(self, metodo, **params):
        self.n += 1
        self._enviar(json.dumps({'id': self.n, 'method': metodo, 'params': params}))
        while True:
            m = self._receber()
            if m.get('id') == self.n:
                if 'error' in m: raise RuntimeError('%s: %s' % (metodo, m['error']))
                return m.get('result', {})
            self.eventos.append(m)

    def js(self, expr, aguardar=True):
        r = self.cmd('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=aguardar)
        if 'exceptionDetails' in r: raise RuntimeError('JS: %s' % json.dumps(r['exceptionDetails'])[:600])
        return r['result'].get('value')

    def esperar(self, expr, limite=20, intervalo=0.2):
        fim = time.time() + limite
        while time.time() < fim:
            if self.js(expr): return True
            time.sleep(intervalo)
        raise TimeoutError('esperando: ' + expr)

    def celular(self, largura=390, altura=844, escala=3, retrato=True):
        self.cmd('Emulation.setDeviceMetricsOverride', width=largura, height=altura, deviceScaleFactor=escala, mobile=True,
                 screenOrientation={'type': 'portraitPrimary' if retrato else 'landscapePrimary', 'angle': 0 if retrato else 90})
        self.cmd('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
        self.cmd('Emulation.setUserAgentOverride', userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')

    def desktop(self, largura=1280, altura=800):
        self.cmd('Emulation.setDeviceMetricsOverride', width=largura, height=altura, deviceScaleFactor=1, mobile=False)

    def ir(self, url):
        self.cmd('Page.enable')
        self.cmd('Page.navigate', url=url)
        time.sleep(0.3)
        self.esperar('document.readyState === "complete" && !!window.IlhasDeTinta && !!IlhasDeTinta.jogo', 20)

    def toque(self, tipo, pontos):
        self.cmd('Input.dispatchTouchEvent', type=tipo, touchPoints=[{'x': x, 'y': y, 'id': 1} for x, y in pontos])

    def deslizar(self, caminho, passo_px=6, pausa=0.012):
        """Arrasto contínuo de toque passando pelos pontos de 'caminho' (várias viradas sem soltar)."""
        x, y = caminho[0]
        self.toque('touchStart', [(x, y)])
        for (x2, y2) in caminho[1:]:
            dist = max(abs(x2 - x), abs(y2 - y))
            n = max(1, int(dist / passo_px))
            for i in range(1, n + 1):
                self.toque('touchMove', [(x + (x2 - x) * i / n, y + (y2 - y) * i / n)])
                time.sleep(pausa)
            x, y = x2, y2
        self.toque('touchEnd', [])

    def tecla(self, codigo, chave):
        self.cmd('Input.dispatchKeyEvent', type='rawKeyDown', code=codigo, key=chave, windowsVirtualKeyCode=0)
        self.cmd('Input.dispatchKeyEvent', type='keyUp', code=codigo, key=chave)

    def tocar(self, x, y):
        self.toque('touchStart', [(x, y)]); time.sleep(0.05); self.toque('touchEnd', [])

    def foto(self, caminho):
        r = self.cmd('Page.captureScreenshot', format='png')
        open(caminho, 'wb').write(base64.b64decode(r['data']))

    def erros(self):
        return self.js('JSON.stringify(window.__erros || [])')

    def instalar_coletor_de_erros(self):
        self.cmd('Page.addScriptToEvaluateOnNewDocument', source='''
          window.__erros = [];
          addEventListener("error", function (e) { window.__erros.push(String(e.message)); });
          var _ce = console.error; console.error = function () { window.__erros.push([].join.call(arguments, " ")); return _ce.apply(console, arguments); };
        ''')

class Chrome:
    def __init__(self, porta, perfil):
        self.porta = porta
        subprocess.run(['rm', '-rf', perfil])
        self.p = subprocess.Popen(['google-chrome', '--headless=new', '--disable-gpu', '--no-first-run',
                                   '--hide-scrollbars', '--remote-debugging-port=%d' % porta, '--user-data-dir=' + perfil,
                                   '--autoplay-policy=no-user-gesture-required', 'about:blank'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/json/version' % porta); break
            except Exception: time.sleep(0.2)

    def nova_aba(self, url='about:blank'):
        req = urllib.request.Request('http://127.0.0.1:%d/json/new?%s' % (self.porta, url), method='PUT')
        info = json.loads(urllib.request.urlopen(req).read())
        return Aba(info['webSocketDebuggerUrl'])

    def fechar(self):
        self.p.terminate()

# Testes de celular (toque de verdade)

Testes que abrem o jogo no **Chrome headless em tempo real** e falam com ele
pelo protocolo de depuração (CDP), sem nenhuma biblioteca extra: `cdp.py` é um
cliente mínimo feito só com a biblioteca padrão do Python.

Eles usam **toques de verdade** (`Input.dispatchTouchEvent`), emulação de
celular (390×844, toque, devicePixelRatio 3) e teclado de verdade no desktop.

Precisa de `python3`, `google-chrome` e o jogo servido localmente:

```sh
python3 -m http.server            # na pasta do projeto (porta 8000)
python3 tests/celular/teste_celular.py /tmp/fotos     # celular sozinho
python3 tests/celular/teste_misto.py   /tmp/fotos     # online: celular x desktop (precisa de internet)
```

(`ILHAS_URL=http://...` muda o endereço testado.)

- `teste_celular.py`: menu, configuração simples, dica de deslizar, um arrasto
  com 4 viradas sem soltar o dedo, deslize curto ignorado, toque e segura sem
  efeito, câmera seguindo, retrato e paisagem, ranking.
- `teste_misto.py`: duas instâncias do Chrome (um "celular" com toque e um
  "desktop" com teclado) jogam online pelo Supabase até o ranking, duas vezes
  — primeiro o celular é o anfitrião, depois o desktop. Confere câmera local
  em cada aparelho, mapa e ranking iguais, o anfitrião no celular "saindo da
  tela" (pausa e aviso no desktop) e a volta ao menu quando o anfitrião sai.
- `teste_instalar.py`: critérios de instalação do Chrome, botão "Instalar",
  dica do iPhone, modo instalado, atalhos e atualização só fora da partida.
- `teste_convite.py`: o desktop cria a sala e toca em "Convidar"; o celular
  abre o link `?sala=1234` e entra com um toque.

O `teste_celular.py` também faz a **primeira partida guiada** com toques de
verdade (sair de casa, virar, voltar), e o `teste_misto.py` testa a **troca de
anfitrião**: o celular-anfitrião fica 15 s fora da tela, o desktop assume, e
quando o celular volta ele recebe o explorador de volta.

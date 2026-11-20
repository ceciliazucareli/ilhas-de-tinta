# Ilhas de Tinta

Jogo infantil de navegador, 2D, de conquista de território. Um pequeno
explorador de chapéu anda por uma ilha flutuante quadriculada. Quando sai do
território pintado, ele deixa um rastro de tinta; ao voltar para casa fechando
uma área, tudo o que ficou dentro do caminho vira território dele.

**Objetivo:** conquistar 80% do mapa.

![Jogando](docs/screenshots/final-jogando.png)

## Como executar

Não precisa instalar nada: é só HTML, CSS e JavaScript puro, sem dependências
e sem imagens externas.

- **Jeito mais fácil:** dê um duplo clique em `index.html`.
- **Com um servidor local** (opcional):

  ```sh
  python3 -m http.server
  ```

  e abra <http://localhost:8000> no navegador.

## Como jogar

| Ação | Teclado | Toque / mouse |
| --- | --- | --- |
| Andar | setas ou **W A S D** | botões ▲ ◀ ▼ ▶ embaixo do mapa |
| Começar / jogar de novo | **Enter** ou **Espaço** | botão na tela |

- O explorador anda sozinho, célula a célula; a tecla escolhe a próxima direção.
- Não dá para dar meia-volta (180°). A borda do mapa faz o explorador parar.
- Fora do território, cada célula visitada vira **rastro**.
- Voltando ao território, o rastro vira território e toda área cercada também.
- Se pisar no próprio rastro, nada de "perder": o rastro some, o explorador
  volta ao último ponto seguro e aparece um "Ops! Tente de novo".
- O HUD mostra a porcentagem conquistada e a meta. Ao chegar em 80%, aparece a
  tela de vitória com confete e o botão "Jogar de novo".

## Como o código está organizado

Os scripts são `<script>` clássicos (não módulos ES) para o jogo abrir direto
em `file://`. Tudo fica no namespace global `window.IlhasDeTinta`.

```
index.html          página, canvas, HUD e telas (início/vitória)
css/style.css       visual da página e da interface (céu, nuvens, HUD, botões)
js/config.js        constantes: grade 30x20, tamanho da célula, cores, velocidade, meta de 80%
js/grid.js          estado do mapa (vazio / território / rastro), captura por flood fill, cálculo da %
js/player.js        posição, direção, movimento célula a célula
js/input.js         teclado (setas e WASD) + botões direcionais na tela
js/renderer.js      desenho da ilha, decoração, rastro, território, explorador e confete
js/ui.js            HUD (% conquistada, meta), mensagens, tela inicial e tela de vitória
js/game.js          loop (requestAnimationFrame), regras e estados: início → jogando → vitória
tests/captura.html  testes da captura de área (abra no navegador)
docs/screenshots/   capturas de tela de cada etapa
```

### Como funciona a captura

Quando o explorador volta ao território com rastro (`Grade.capturar` em
`js/grid.js`):

1. todo o rastro vira território;
2. um flood fill (busca em largura) parte das bordas do mapa e anda só por
   células que **não** são território;
3. toda célula que não é território e não foi alcançada está cercada, então
   também vira território.

### Testes

Abra `tests/captura.html` no navegador. Ele testa área simples, forma em L,
captura encostada na borda, área aberta para a borda e rastro que não fecha
área. A página fica verde quando tudo passa.

### Ajustes rápidos

Em `js/config.js` dá para mudar o tamanho da grade, a velocidade, as cores e a
meta. Para testar a vitória rapidinho, no console do navegador:

```js
IlhasDeTinta.config.META = 0.05;
```

## Limitações conhecidas

- A borda do mapa não funciona como parede na captura: uma área só é capturada
  se ficar totalmente cercada pelo território (como pede a regra do flood fill
  a partir das bordas). Para conquistar perto da borda, o rastro precisa passar
  pelas células da própria borda.
- Em telas de celular o mapa inteiro encolhe para caber na largura, então as
  células ficam pequenas (cerca de 11 px).
- Sem sons, inimigos, power-ups ou fases extras: é um protótipo só com o básico.

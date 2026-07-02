# Nihongo Loop UI Patterns

## Direcao e sensacao

Nihongo Loop e uma ferramenta de estudo e revisao. A interface deve parecer calma, clara e operacional: leitura em primeiro lugar, acoes de estudo sempre evidentes e detalhes tecnicos recolhidos quando nao forem a tarefa principal.

## Layout

- O app roda dentro de um frame `h-dvh` com coluna flex e `min-h-0`.
- Telas principais usam conteudo com rolagem interna, nao rolagem global que empurre a navegacao.
- A bottom nav fica no fluxo do layout, com `app-bottom-nav`, `shrink-0` e safe-area via `env(safe-area-inset-bottom)`.
- Use `flex-1 min-h-0` nos wrappers de tela renderizados pelo roteador.

## Mobile

- Prioridade para 390px de largura.
- Conteudo longo deve rolar dentro da area principal.
- Header e footer nao devem esconder ou empurrar a tarefa principal para fora da viewport.
- Paineis secundarios e tecnicos devem ser recolhiveis em telas pequenas.

## Acessibilidade

- Botao apenas com icone precisa de `aria-label`.
- Toggle visual precisa de `aria-pressed` quando representar estado ligado/desligado.
- Campos precisam de `label htmlFor` + `id`, ou `aria-label` quando label visual nao for adequado.
- Alvos de toque pequenos devem usar:
  - `tap-icon`: minimo 40x40px.
  - `tap-icon-sm`: minimo 36x36px para acoes compactas.
- Nomes acessiveis usados por testes devem ser preservados quando possivel; se a copy visual mudar, use `aria-label` para manter o contrato.

## Componentes e estados

- Reutilize utilitarios existentes: `.screen`, `.screen-gray`, `.screen-header`, `.screen-title`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card` e `.card-section`.
- Estados desabilitados devem explicar o desbloqueio quando a acao principal depender de uma escolha anterior.
- Acoes destrutivas devem ter label humano, confirmacao e distancia visual suficiente de acoes comuns.
- Fila e processamento devem usar linguagem operacional: "Tentar novamente", "Limpar fila", "Nova tentativa", "Revisar", "Sem resposta".

## Densidade e hierarquia

- O app e denso, mas nao deve parecer painel tecnico por padrao.
- Conteudo de estudo, frases e verbetes vem antes de diagnostico/fila.
- Use texto pequeno e peso alto para labels, mas evite depender apenas de texto em 9-10px para tarefas primarias.
- Cores continuam semanticamente contidas: indigo para acao/IA, rose para destrutivo, emerald para sucesso, amber para atencao.

## Padroes recentes

- Dicionario: painel de IA/fila recolhivel; lista de verbetes permanece como foco.
- Estudo: player com corpo rolavel para frases/traducoes longas.
- Leitura: acoes de card com `tap-icon-sm`, `aria-label` e estados pressionados para favorito/dificil.
- Formularios: labels programaticamente associados em login, importar, estudar, setup de quiz/baralho e configuracoes.

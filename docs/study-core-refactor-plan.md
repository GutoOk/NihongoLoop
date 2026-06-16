# Plano de refatoracao pedagogica do nucleo Estudar

## Diagnostico

O botao Estudar era tratado como entrada para telas e filtros, nao como um fluxo pedagogico. A decisao ficava cedo demais nas maos do usuario: escolher fonte, tipo, ordem, quantidade, modo de audio e quiz antes de receber uma orientacao clara. Isso aumenta carga cognitiva, especialmente para usuarios ansiosos, neurodivergentes ou sem rotina consolidada.

O sistema ja tinha pecas boas: estudo por fonte, blocos curtos, quiz, progresso, favoritos, dificuldade, SRS de palavras, contexto por frases reais e modos de audio. O problema era hierarquia: tudo aparecia como opcoes equivalentes, e a logica adaptativa nao guiava a entrada.

## Principios

- Reduzir decisoes iniciais.
- Priorizar recuperacao ativa antes de novo conteudo.
- Manter estudo contextual por frases reais.
- Usar blocos curtos para sustentar atencao.
- Repetir sem monotonia: fonte, revisao, palavras dificeis e quiz.
- Mostrar progresso e fim de sessao com clareza.
- Preservar modo personalizado, mas como camada avancada.

## Etapa 1: Porta pedagogica do Estudar

Status: implementada.

- Criar `StudyPlanner` para escolher uma sessao recomendada.
- Trocar a tela inicial por caminhos principais:
  - Comecar agora
  - Revisar o que estou esquecendo
  - Continuar de onde parei
  - Estudar uma fonte especifica
  - Treinar palavras dificeis
  - Modo personalizado
- Adicionar alvos adaptativos no player:
  - `review_due`
  - `difficult_words`
- Manter compatibilidade com o fluxo padrao fonte -> estudo -> quiz.

Testes:
- `StudyPlanner` prioriza revisao vencida.
- `StudyPlanner` usa palavras dificeis quando nao ha revisao vencida.
- `StudyPlanner` continua fonte quando nao ha divida de revisao.
- `npm.cmd run lint`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run test:e2e:mobile`

## Etapa 2: Separar montagem de sessao do player

Objetivo: tirar `loadItems` de `StudyPlayerScreen`.

- Criar `StudySessionBuilder`.
- Centralizar filtros de frases/palavras.
- Cobrir:
  - fonte
  - novas
  - favoritas
  - dificeis
  - sem traducao
  - sem leitura
  - revisao vencida
  - palavras dificeis
- O player deve apenas tocar, exibir e registrar interacoes.

Testes:
- Cada target monta os itens esperados.
- Itens sem significado nao entram em quizzes de significado.
- Fonte sem termos aciona fallback de deteccao apenas onde necessario.

## Etapa 3: Melhorar recuperacao ativa

Objetivo: transformar estudo passivo em pratica.

- Antes de mostrar traducao, exibir uma pausa curta ou comando visual.
- Para PT -> JP, mostrar significado primeiro e so revelar japones depois.
- Registrar acerto/erro no final de item quando houver resposta ativa.
- Integrar feedback simples:
  - Errei
  - Quase
  - Acertei
- Atualizar SRS com esse feedback.

Testes:
- Feedback atualiza `correct_count`, `wrong_count`, `mastery` e `due_at`.
- Sessao termina com resumo de itens dificeis.

## Etapa 4: Resumo e continuidade

Objetivo: dar começo, meio e fim claros.

- Criar resumo unificado apos sessao.
- Mostrar:
  - itens vistos
  - acertos/erros
  - proxima recomendacao
  - botao unico "Continuar rotina"
- Standard flow deve decidir se repete bloco ou avanca com base no desempenho.

Testes:
- Baixa taxa de acerto sugere repetir.
- Boa taxa de acerto sugere avancar.
- Offset da fonte so avanca quando criterio minimo e atingido.

## Etapa 5: Integrar dicionario sem quebrar foco

Objetivo: consulta sem interromper estudo.

- Mini-dicionario deve abrir como apoio rapido.
- Acao secundaria permite abrir ficha completa.
- Voltar deve retornar exatamente ao item da sessao.

Testes:
- Abrir e fechar mini-dicionario nao muda indice.
- Navegar para ficha e voltar preserva contexto.

## Etapa 6: Personalizacao avancada limpa

Objetivo: preservar profundidade sem sobrecarregar.

- Reorganizar `StudySetupScreen` em etapas:
  - Conteudo
  - Objetivo
  - Ritmo
  - Audio
- Substituir grades longas por presets:
  - Leve
  - Foco
  - Revisao
  - Shadowing
- Exibir opcoes tecnicas apenas sob "ajustes avancados".

Testes:
- Presets geram configs corretas.
- Config manual ainda permite os modos antigos.

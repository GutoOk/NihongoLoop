# Plano de refatoracao do nucleo de estudo

## Objetivo final

Transformar o botao **Estudar** no centro pedagogico do Nihongo Loop: entrada rapida, poucas decisoes visiveis, pratica de recuperacao ativa, repeticao espacada, continuidade clara e personalizacao salva para usuarios avancados.

## Fase 1 - Centralizar a logica de sessao

- Criar um construtor unico de sessoes para frases, palavras e contextos.
- Tirar filtros e regras duplicadas do player visual.
- Garantir que palavras sem significado nao entrem automaticamente em revisao pedagogica.
- Emitir avisos quando a sessao tiver lacunas reais, como frases sem traducao ou leitura.

Testes:

- Revisao vencida escolhe apenas palavras estudaveis.
- Sessoes de frases avisam quando faltam dados essenciais.
- Build TypeScript sem regressao.

## Fase 2 - Planejador pedagogico do botao Estudar

- Avaliar progresso, palavras vencidas, dificuldades, fontes e estudos salvos.
- Escolher automaticamente entre revisar vencidas, treinar dificeis ou continuar uma fonte.
- Mostrar poucos caminhos principais:
  - Continuar de onde parei.
  - Revisar o que estou esquecendo.
  - Estudar uma fonte especifica.
  - Treinar palavras dificeis.
  - Modo personalizado.

Testes:

- Revisao vencida tem prioridade sobre conteudo novo.
- Continuidade de fonte funciona quando nao ha revisao urgente.
- Tela Estudar nao exige que o usuario entenda a logica interna.

## Fase 3 - Player com recuperacao ativa

- A resposta nao aparece imediatamente.
- O ciclo principal vira: lembrar, revelar, marcar erro/quase/acerto, avancar.
- Feedback atualiza progresso e alimenta repeticao espacada.
- Estatisticas curtas da sessao aparecem sem poluir a tela.
- Audio continua disponivel para associar som, escrita e significado.

Testes:

- Revelar resposta mostra traducao/significado.
- Errei/quase/acertei atualizam progresso sem duplicar clique no mesmo item.
- Proximo/anterior reiniciam o estado de revelacao.

## Fase 4 - Estudos personalizados salvos

- O modo personalizado continua existindo, mas fica em camada avancada.
- Usuario pode salvar presets com nome.
- Estudos salvos aparecem na tela Estudar para continuar depois.
- A configuracao salva reutiliza o mesmo construtor centralizado.

Testes:

- Salvar preset cria uma sessao `custom_template`.
- Preset salvo inicia com a configuracao armazenada.
- Campos obrigatorios impedem iniciar preset sem nome.

## Fase 5 - Validacao visual e manual

- Abrir Estudar e confirmar que a primeira tela e objetiva.
- Confirmar que os cards nao encavalam em mobile.
- Rodar um estudo recomendado, um estudo por fonte e um estudo salvo.
- Confirmar que palavras pendentes sem significado nao aparecem como revisao util.
- Confirmar que o usuario consegue estudar em ate dois toques.

## Proximas melhorias possiveis

- Criar uma tela de resumo ao fim da sessao com recomendacao do proximo passo.
- Permitir editar, renomear e apagar estudos personalizados salvos.
- Unificar textos antigos com acentos quebrados em toda a aplicacao.
- Criar metricas de streak leve e tempo de foco sem transformar estudo em jogo pesado.

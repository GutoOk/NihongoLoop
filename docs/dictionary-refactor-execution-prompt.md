# Prompt de execucao: auditoria e refatoracao completa do Dicionario

Voce e o Codex trabalhando no projeto Nihongo Loop. Execute ate o fim, sem pedir confirmacao, com testes, commit e push na `main`.

## Objetivo

Investigar e melhorar toda a pagina de Dicionario, especialmente o fluxo de pendencias e enriquecimento por IA. Corrigir bugs, inconsistencias de status, contadores imprecisos, fila que nao processa, card de acompanhamento infiel, controles confusos de pausar/retomar/cancelar e qualquer redundancia ou UI encavalada.

## Escopo tecnico

1. Mapear `DictionaryScreen`, `DictionaryEntryScreen`, `DictionaryRepository`, `AiJobRepository`, `AiJobService`, `ProcessingRunner`, endpoints `/api/ai/*`, tipos Supabase e testes existentes.
2. Descobrir como uma palavra vira `pending`, como entra na fila, como o job e processado, como o resultado e aplicado e como o status deixa de ser pendente.
3. Verificar se jobs antigos `completed`, `error` ou `cancelled` impedem a recriacao de jobs novos por causa de `input_hash` e constraint unica.
4. Garantir que o botao "Completar pendentes" enfileire exatamente as pendencias do escopo mostrado ao usuario, respeitando fonte/tipo/nivel.
5. Tornar o card de acompanhamento fiel ao estado atual da fila, separando:
   - palavras pendentes reais;
   - jobs aguardando;
   - jobs rodando;
   - jobs com falha;
   - jobs concluidos que ainda nao resolveram a palavra;
   - API/servidor acessivel ou inacessivel.
6. Deixar claro que o front nao inicia o processo Node sozinho; ele controla a fila e chama a API do servidor quando o servidor esta rodando.
7. Melhorar pausar, retomar, cancelar e limpar fila para nao deixar jobs presos em `running`.
8. Revisar textos para portugues claro, sem termos em ingles visiveis.
9. Remover redundancias e corrigir layout para cada bloco importante ocupar linhas legiveis em mobile.
10. Adicionar testes unitarios para os calculos de escopo/fila e para o re-enfileiramento de jobs antigos.
11. Rodar `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build` e, se cabivel, e2e mobile.

## Criterios de aceite

- Palavra pendente com job antigo finalizado ou com erro pode voltar para `pending` e ser processada novamente.
- O numero no botao "Completar pendentes" corresponde ao que sera enfileirado.
- O card nao mistura historico antigo com fila atual como se fosse progresso atual.
- Usuario consegue ver se a API local esta online.
- Pausar/retomar/cancelar nao deixa o usuario sem entender o que aconteceu.
- Testes automatizados cobrem os bugs principais.
- Entrega final inclui resumo, testes rodados e commit/push na `main`.

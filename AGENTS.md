# AGENTS.md

## Comandos confirmados

- Desenvolvimento: `npm run dev` (`tsx server.ts`).
- Build: `npm run build` (`vite build` e bundle do `server.ts` para `dist/server.cjs`).
- Start de produção local: `npm run start`.
- Preview Vite: `npm run preview`.
- Typecheck: `npm run lint` (`tsc --noEmit`).
- Testes unitários/integrados: `npm run test` (`vitest run`).
- E2E: `npm run test:e2e`; mobile: `npm run test:e2e:mobile`.
- Validação completa existente: `npm run test:all`.

## Quando eu pedir push

- Faca push apenas dos arquivos normais e necessarios para a tarefa.
- Antes de commit/push, exclua do stage arquivos locais de agente, cache, configuracao pessoal ou estado de ferramenta, como `.codex/`, `.serena/`, `.agents/`, logs, relatorios temporarios e artefatos equivalentes, salvo pedido explicito.
- Nao publique secrets, configuracao local pessoal ou arquivos gerados que nao sejam parte real da mudanca.
- Depois de filtrar o stage, execute diretamente `git commit -m "<mensagem curta e clara>"` e `git push`.
- Nao faca auditorias, refactors, testes extras ou planos antes disso, salvo impedimento tecnico real ou risco de expor segredo.

## Arquitetura resumida

- App React/Vite em `src`, servidor Express/Node em `server.ts` e worker de IA em `server/ai`.
- Supabase é acessado pelo front via repositórios em `src/repositories` e por RPCs SQL definidas em `schema.sql`.
- A fila de IA usa a tabela `ai_jobs`, runs/estágios de processamento e RPCs como `enqueue_ai_jobs_bulk`, `claim_ai_jobs`, `start_claimed_ai_job`, `complete_ai_job`, `fail_ai_job_for_retry` e `recover_expired_ai_job_leases`.

## Fila de IA

- Tipos suportados em `src/features/ai/jobTypes.ts`: `prepare_sentence`, `translate_sentence`, `generate_sentence_reading`, `detect_sentence_terms`, `enrich_dictionary_entry`.
- Limites padrão atuais em `src/features/ai/jobQueueConfig.ts`: global `8`, por usuário `4`, lote de claim `8`, lease `300s`, com concorrência por tipo.
- `server/ai/queueWorker.ts` chama `recover_expired_ai_job_leases`, usa `claimCoordinatedJobs` com `SUPPORTED_AI_JOB_TYPES` e processa jobs com `Promise.allSettled`.
- Todo novo tipo de job precisa estar na lista suportada, em `is_supported_ai_job_type`, ter handler explícito no worker e caminho de conclusão/falha para não ficar pendente indefinidamente.
- Jobs concluídos, cancelados, obsoletos, falhos ou em revisão não devem ser exibidos como pendentes; pendente operacional é apenas `pending`, `claimed`, `running` ou `retry_wait`.
- Erro em um job não pode travar jobs independentes; preserve processamento isolado por job e persistência de falha/retry.

## Supabase e dados

- Não altere banco remoto, dados reais, secrets, deploy, RLS, grants ou migrations aplicadas sem pedido explícito.
- Mudanças em `schema.sql` ou `supabase/migrations` exigem checar chamadores RPC, tipos retornados, permissões e efeito em dados persistidos.
- Evite inventar tabelas, colunas, RPCs ou variáveis de ambiente; confirme no schema/código antes.
- Em consultas por job, evite N+1 e leituras repetidas: prefira RPCs existentes, payload/input já carregados e consultas em lote quando tocar fluxo de fila.

## Áreas de cautela

- `schema.sql`, `supabase/migrations`, `server/ai/queueWorker.ts`, `src/features/ai/*`, `src/repositories/aiJobRepository.ts` e `src/core/supabaseClient`.
- Fluxos de cancelamento, retry, lease, heartbeat, conclusão de job e avanço de `processing_runs`.
- Configurações de build/teste: `package.json`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`.

## Uso de Serena

- Use Serena apenas em mudanças estruturais, multi-arquivo ou quando for necessário mapear símbolos/referências antes de editar.
- Para ajustes pequenos, leia somente os arquivos diretamente envolvidos e faça a menor alteração segura.

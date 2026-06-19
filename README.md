# Nihongo Loop

Nihongo Loop transforma fontes em japones em material de estudo: frases, traducao, leitura, termos, dicionario pessoal e revisao.

## Arquitetura

O processamento de IA usa uma fila persistente no Supabase:

1. A interface cria ou retoma uma `processing_run`.
2. Jobs individuais sao gravados em `ai_jobs`.
3. O servico `nihongo-loop-worker` reivindica jobs de forma atomica e executa uma chamada de IA por job.
4. Resultados, tentativas, custos, tokens, erros e timestamps sao persistidos no banco.
5. A interface apenas acompanha o estado persistido.

Servicos Cloud Run:

- `nihongo-loop-web`: React, API leve, health/version.
- `nihongo-loop-worker`: consumidor oficial de `ai_jobs`.

## Ambiente Local

Instale dependencias:

```bash
npm install
```

Crie um `.env.local` nao versionado a partir de `.env.example`. Valores privados como `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` e `INTERNAL_HEALTH_TOKEN` devem ficar apenas no ambiente local ou em Secret Manager.

Rodar web em desenvolvimento:

```bash
npm run dev
```

Build de producao:

```bash
npm run build
npm start
```

Para rodar o worker localmente, configure `AI_WORKER_ONLY=true` e as credenciais privadas em `.env.local`.

## Banco

`schema.sql` e o baseline limpo e reproduzivel do Supabase/Postgres. Ele cria tabelas, constraints, RLS, indices e RPCs da fila. Como a arquitetura atual nao preserva modelo legado, rebuilds devem partir desse arquivo.

Depois do rebuild, cadastre administradores em `public.app_admins`.

## Validacao

Comandos principais:

```bash
npm run lint
npm test
npm run test:e2e:mobile
npm run build
```

O CI executa scan simples de secrets, lint, testes, e2e mobile, build, deploy de `nihongo-loop-web` e `nihongo-loop-worker`, e healthcheck basico.

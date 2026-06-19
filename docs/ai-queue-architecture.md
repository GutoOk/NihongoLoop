# AI Queue Architecture

## Official Pipeline

The only supported AI processing path is now:

1. UI creates or resumes a `processing_runs` record.
2. UI plans individual `ai_jobs` with real targets (`sentence` or `dictionary_entry`) and a `run_id`.
3. Cloud Run starts `startAiQueueWorker` with `SUPABASE_SERVICE_ROLE_KEY`.
4. The worker atomically claims jobs through `claim_ai_jobs` using `FOR UPDATE SKIP LOCKED`.
5. Each job performs exactly one AI call and persists its own result, metrics, timestamps and errors.
6. `processing_runs` counters are refreshed by the `ai_jobs` trigger in migration v24.

Browser-side processing and HTTP batch endpoints are retired by default. `ENABLE_LEGACY_AI_HTTP=true` exists only as an explicit emergency switch for old HTTP endpoints and must stay disabled in normal operation.

## Individual Job Types

- `translate_sentence`: translates one sentence.
- `generate_sentence_reading`: writes `kana` and `romaji` for one sentence.
- `detect_sentence_terms`: detects and persists terms for one sentence with grouped upserts.
- `enrich_dictionary_entry`: enriches one dictionary entry and upserts senses/forms.

Batch means a worker claim cycle containing multiple individual jobs. It does not mean one AI request with multiple items.

## Worker Concurrency

Environment defaults:

- `AI_WORKER_TRANSLATE_CONCURRENCY=8`
- `AI_WORKER_READING_CONCURRENCY=8`
- `AI_WORKER_TERMS_CONCURRENCY=4`
- `AI_WORKER_DICTIONARY_CONCURRENCY=5`
- `AI_WORKER_POLL_MS=2000`
- `AI_WORKER_LEASE_SECONDS=300`

Cloud Run is configured with `minScale: 1`, `maxScale: 1`, CPU always allocated, and service-role Supabase access. Increase scale only after validating provider rate limits and job claim metrics.

## Retired Paths

- `SourcePreparationRunner` no longer processes jobs.
- `ProcessingRunner` and `GlobalAiQueueRunner` are no-op orchestration wrappers.
- `/api/ai/process-job`, `/api/ai/process-jobs-batch`, and `/api/ai/trigger-batch-jobs` return 410 unless explicitly re-enabled.
- `supabase/functions/process-jobs` returns 410.

## Validation

Run before deploy:

```bash
npm run test:all
```

Apply migrations v23 and v24 before enabling the worker in production.

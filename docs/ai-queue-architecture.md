# AI Queue Architecture

## Official Pipeline

The supported AI processing path is:

1. `nihongo-loop-web` creates or resumes a `processing_runs` record.
2. The web app plans individual `ai_jobs` with real targets, content hashes and a `run_id`.
3. `nihongo-loop-worker` starts in worker-only mode and validates Supabase, private credentials and schema version.
4. The worker atomically claims jobs through `claim_ai_jobs` using `FOR UPDATE SKIP LOCKED`.
5. Each job performs exactly one AI call and persists its own result, metrics, timestamps and errors.
6. The worker keeps job leases alive with heartbeat and expired leases are recovered through `recover_expired_ai_job_leases`.
7. The UI observes persisted run/job state. The browser never consumes `ai_jobs`.

Batch means one worker claim cycle with multiple individual jobs. It never means one AI request with multiple items.

## Services

- `nihongo-loop-web`: serves the React app, lightweight API health/version endpoints and run/job views.
- `nihongo-loop-worker`: consumes `ai_jobs`, calls Gemini, applies results, records attempts and recovers leases.

Private values are injected through Cloud Run Secret Manager references:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `INTERNAL_HEALTH_TOKEN`

No private value belongs in YAML, frontend env, GitHub workflow text or documentation.

## Individual Job Types

- `prepare_sentence`: translates one sentence, writes `kana`/`romaji`, and detects terms in one AI call.
- `translate_sentence`, `generate_sentence_reading`, `detect_sentence_terms`: legacy sentence jobs still accepted by the worker.
- `enrich_dictionary_entry`: enriches one dictionary entry and upserts senses/forms.

## Worker Concurrency

Initial production defaults:

- global: `8`
- per user: `4`
- `prepare_sentence`: `3`
- legacy sentence jobs keep their previous limits.
- `enrich_dictionary_entry`: `1`

The global budget is authoritative; type limits do not add up beyond it.

## Database

`schema.sql` is the reproducible clean baseline. It defines:

- `processing_runs`
- `processing_run_stages`
- `ai_jobs`
- `ai_job_attempts`
- `ai_model_prices`
- `schema_versions`
- queue RPCs for claim, start, heartbeat, complete, fail, release and lease recovery

The worker requires `schema_versions('ai_queue') = 2026-06-ai-queue-v28`.

After applying the destructive clean baseline, bootstrap the real Auth admin with the service role before starting the worker:

```sql
select public.bootstrap_app_admin('admin@example.com');
select public.verify_ai_queue_reset();
```

`verify_ai_queue_reset()` must report no missing tables, columns or RPCs, `admin_exactly_one = true`, and a compatible worker schema version.

## Retired Paths

The following paths are not part of the architecture:

- browser queue runners
- HTTP AI processing endpoints
- batch AI requests
- Edge Function queue consumers
- legacy batch job types

Only `nihongo-loop-worker` consumes `ai_jobs`.

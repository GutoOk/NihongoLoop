-- Migration v24: processing run queue snapshots.
-- Keeps execution counters in Postgres as jobs are inserted, updated or removed.

GRANT EXECUTE ON FUNCTION public.assert_ai_queue_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_processing_run_queue_snapshot(p_run_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INTEGER := 0;
  v_pending INTEGER := 0;
  v_running INTEGER := 0;
  v_completed INTEGER := 0;
  v_failed INTEGER := 0;
  v_retry INTEGER := 0;
  v_review INTEGER := 0;
  v_cancelled INTEGER := 0;
  v_obsolete INTEGER := 0;
  v_cost NUMERIC := 0;
  v_ai_calls INTEGER := 0;
  v_has_active BOOLEAN := false;
  v_next_status TEXT;
BEGIN
  IF p_run_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'pending')::integer,
    count(*) FILTER (WHERE status IN ('claimed', 'running'))::integer,
    count(*) FILTER (WHERE status IN ('completed', 'applied'))::integer,
    count(*) FILTER (WHERE status IN ('failed', 'error'))::integer,
    count(*) FILTER (WHERE status = 'retry_wait')::integer,
    count(*) FILTER (WHERE status = 'needs_review')::integer,
    count(*) FILTER (WHERE status = 'cancelled')::integer,
    count(*) FILTER (WHERE status = 'obsolete')::integer,
    COALESCE(sum(cost_actual), 0),
    COALESCE(sum(COALESCE(attempts, 0)), 0)::integer
  INTO
    v_total,
    v_pending,
    v_running,
    v_completed,
    v_failed,
    v_retry,
    v_review,
    v_cancelled,
    v_obsolete,
    v_cost,
    v_ai_calls
  FROM public.ai_jobs
  WHERE run_id = p_run_id;

  v_has_active := (v_pending + v_running + v_retry) > 0;

  v_next_status := CASE
    WHEN v_total = 0 THEN NULL
    WHEN v_has_active THEN 'running'
    WHEN v_review > 0 THEN 'needs_review'
    WHEN v_failed > 0 THEN 'failed'
    WHEN v_completed > 0 AND (v_completed + v_cancelled + v_obsolete) >= v_total THEN 'completed'
    WHEN v_cancelled > 0 AND (v_cancelled + v_obsolete) >= v_total THEN 'cancelled'
    ELSE NULL
  END;

  UPDATE public.processing_runs
  SET
    planned_jobs = v_total,
    pending_jobs = v_pending,
    running_jobs = v_running,
    completed_jobs = v_completed,
    failed_items = v_failed,
    retry_jobs = v_retry,
    review_jobs = v_review,
    cancelled_jobs = v_cancelled,
    obsolete_jobs = v_obsolete,
    processed_jobs = v_completed + v_failed + v_review + v_cancelled + v_obsolete,
    processed_items = v_completed,
    total_cost_actual = v_cost,
    ai_call_count = v_ai_calls,
    status = COALESCE(v_next_status, status),
    finished_at = CASE
      WHEN v_next_status IN ('completed', 'failed', 'cancelled', 'needs_review') THEN COALESCE(finished_at, now())
      WHEN v_next_status = 'running' THEN NULL
      ELSE finished_at
    END,
    updated_at = now()
  WHERE id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_processing_run_queue_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_processing_run_queue_snapshot(OLD.run_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_processing_run_queue_snapshot(NEW.run_id);
  IF TG_OP = 'UPDATE' AND OLD.run_id IS DISTINCT FROM NEW.run_id THEN
    PERFORM public.refresh_processing_run_queue_snapshot(OLD.run_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_jobs_refresh_processing_run_snapshot ON public.ai_jobs;
CREATE TRIGGER trg_ai_jobs_refresh_processing_run_snapshot
AFTER INSERT OR UPDATE OR DELETE ON public.ai_jobs
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_processing_run_queue_snapshot();

GRANT EXECUTE ON FUNCTION public.refresh_processing_run_queue_snapshot(UUID) TO authenticated, service_role;

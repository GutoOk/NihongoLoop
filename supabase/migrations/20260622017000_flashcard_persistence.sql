CREATE TABLE IF NOT EXISTS public.flashcard_decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.flashcard_settings (
  user_id TEXT PRIMARY KEY,
  daily_new_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_new_limit >= 0),
  daily_review_limit INTEGER NOT NULL DEFAULT 0 CHECK (daily_review_limit >= 0),
  desired_retention NUMERIC NOT NULL DEFAULT 0.9 CHECK (desired_retention >= 0.5 AND desired_retention <= 0.99),
  autoplay_audio BOOLEAN NOT NULL DEFAULT FALSE,
  show_examples BOOLEAN NOT NULL DEFAULT TRUE,
  default_mode TEXT NOT NULL DEFAULT 'ja_pt',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.flashcard_daily_activity (
  user_id TEXT NOT NULL,
  activity_date DATE NOT NULL,
  reviews INTEGER NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  new_cards INTEGER NOT NULL DEFAULT 0 CHECK (new_cards >= 0),
  again INTEGER NOT NULL DEFAULT 0 CHECK (again >= 0),
  sessions_count INTEGER NOT NULL DEFAULT 0 CHECK (sessions_count >= 0),
  hour_histogram JSONB NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user_created ON public.flashcard_decks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flashcard_daily_activity_user_date ON public.flashcard_daily_activity(user_id, activity_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_flashcard_decks_touch') THEN
    CREATE TRIGGER tr_flashcard_decks_touch BEFORE UPDATE ON public.flashcard_decks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_flashcard_settings_touch') THEN
    CREATE TRIGGER tr_flashcard_settings_touch BEFORE UPDATE ON public.flashcard_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_flashcard_daily_activity_touch') THEN
    CREATE TRIGGER tr_flashcard_daily_activity_touch BEFORE UPDATE ON public.flashcard_daily_activity FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.flashcard_empty_hour_histogram()
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT jsonb_agg(0 ORDER BY i) FROM generate_series(0, 23) AS i;
$$;

CREATE OR REPLACE FUNCTION public.flashcard_increment_hour_histogram(p_histogram JSONB, p_hour INTEGER)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  WITH normalized AS (
    SELECT CASE
      WHEN jsonb_typeof(p_histogram) = 'array' THEN
        CASE WHEN jsonb_array_length(p_histogram) = 24 THEN p_histogram ELSE public.flashcard_empty_hour_histogram() END
      ELSE public.flashcard_empty_hour_histogram()
    END AS hist
  )
  SELECT jsonb_agg(
    CASE
      WHEN ordinality - 1 = GREATEST(0, LEAST(23, p_hour)) THEN COALESCE((value #>> '{}')::INTEGER, 0) + 1
      ELSE COALESCE((value #>> '{}')::INTEGER, 0)
    END
    ORDER BY ordinality
  )
  FROM normalized, jsonb_array_elements(normalized.hist) WITH ORDINALITY;
$$;

CREATE OR REPLACE FUNCTION public.record_flashcard_daily_activity(
  p_reviews INTEGER DEFAULT 0,
  p_new_cards INTEGER DEFAULT 0,
  p_again INTEGER DEFAULT 0,
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
)
RETURNS public.flashcard_daily_activity
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  request_user TEXT;
  local_date DATE;
  local_hour INTEGER;
  updated_row public.flashcard_daily_activity;
BEGIN
  request_user := public.request_user_id(NULL);
  local_date := (NOW() AT TIME ZONE COALESCE(NULLIF(p_timezone, ''), 'America/Sao_Paulo'))::DATE;
  local_hour := EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(NULLIF(p_timezone, ''), 'America/Sao_Paulo')))::INTEGER;

  INSERT INTO public.flashcard_daily_activity(
    user_id, activity_date, reviews, new_cards, again, sessions_count, hour_histogram
  )
  VALUES (
    request_user,
    local_date,
    GREATEST(0, COALESCE(p_reviews, 0)),
    GREATEST(0, COALESCE(p_new_cards, 0)),
    GREATEST(0, COALESCE(p_again, 0)),
    1,
    public.flashcard_increment_hour_histogram(public.flashcard_empty_hour_histogram(), local_hour)
  )
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET
    reviews = flashcard_daily_activity.reviews + GREATEST(0, COALESCE(EXCLUDED.reviews, 0)),
    new_cards = flashcard_daily_activity.new_cards + GREATEST(0, COALESCE(EXCLUDED.new_cards, 0)),
    again = flashcard_daily_activity.again + GREATEST(0, COALESCE(EXCLUDED.again, 0)),
    sessions_count = flashcard_daily_activity.sessions_count + 1,
    hour_histogram = public.flashcard_increment_hour_histogram(flashcard_daily_activity.hour_histogram, local_hour),
    updated_at = NOW()
  RETURNING * INTO updated_row;

  RETURN updated_row;
END;
$$;

ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_decks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_daily_activity FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.flashcard_decks FROM anon;
REVOKE ALL ON public.flashcard_settings FROM anon;
REVOKE ALL ON public.flashcard_daily_activity FROM anon;
REVOKE ALL ON public.flashcard_decks FROM authenticated;
REVOKE ALL ON public.flashcard_settings FROM authenticated;
REVOKE ALL ON public.flashcard_daily_activity FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_decks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_daily_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_flashcard_daily_activity(INTEGER, INTEGER, INTEGER, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "flashcard_decks select own" ON public.flashcard_decks;
DROP POLICY IF EXISTS "flashcard_decks insert own" ON public.flashcard_decks;
DROP POLICY IF EXISTS "flashcard_decks update own" ON public.flashcard_decks;
DROP POLICY IF EXISTS "flashcard_decks delete own" ON public.flashcard_decks;
CREATE POLICY "flashcard_decks select own" ON public.flashcard_decks FOR SELECT TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_decks insert own" ON public.flashcard_decks FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_decks update own" ON public.flashcard_decks FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin()) WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_decks delete own" ON public.flashcard_decks FOR DELETE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());

DROP POLICY IF EXISTS "flashcard_settings select own" ON public.flashcard_settings;
DROP POLICY IF EXISTS "flashcard_settings insert own" ON public.flashcard_settings;
DROP POLICY IF EXISTS "flashcard_settings update own" ON public.flashcard_settings;
DROP POLICY IF EXISTS "flashcard_settings delete own" ON public.flashcard_settings;
CREATE POLICY "flashcard_settings select own" ON public.flashcard_settings FOR SELECT TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_settings insert own" ON public.flashcard_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_settings update own" ON public.flashcard_settings FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin()) WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_settings delete own" ON public.flashcard_settings FOR DELETE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());

DROP POLICY IF EXISTS "flashcard_daily_activity select own" ON public.flashcard_daily_activity;
DROP POLICY IF EXISTS "flashcard_daily_activity insert own" ON public.flashcard_daily_activity;
DROP POLICY IF EXISTS "flashcard_daily_activity update own" ON public.flashcard_daily_activity;
DROP POLICY IF EXISTS "flashcard_daily_activity delete own" ON public.flashcard_daily_activity;
CREATE POLICY "flashcard_daily_activity select own" ON public.flashcard_daily_activity FOR SELECT TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_daily_activity insert own" ON public.flashcard_daily_activity FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_daily_activity update own" ON public.flashcard_daily_activity FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin()) WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_daily_activity delete own" ON public.flashcard_daily_activity FOR DELETE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());

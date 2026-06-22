CREATE TABLE IF NOT EXISTS public.flashcard_deck_items (
  deck_id TEXT NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('word', 'sentence')),
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deck_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_flashcard_deck_items_user_deck_position
  ON public.flashcard_deck_items(user_id, deck_id, position);
CREATE INDEX IF NOT EXISTS idx_flashcard_deck_items_lookup
  ON public.flashcard_deck_items(user_id, item_type, item_id);

ALTER TABLE public.flashcard_deck_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_deck_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.flashcard_deck_items FROM anon;
REVOKE ALL ON public.flashcard_deck_items FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_deck_items TO authenticated;

DROP POLICY IF EXISTS "flashcard_deck_items select own" ON public.flashcard_deck_items;
DROP POLICY IF EXISTS "flashcard_deck_items insert own" ON public.flashcard_deck_items;
DROP POLICY IF EXISTS "flashcard_deck_items update own" ON public.flashcard_deck_items;
DROP POLICY IF EXISTS "flashcard_deck_items delete own" ON public.flashcard_deck_items;
CREATE POLICY "flashcard_deck_items select own" ON public.flashcard_deck_items
  FOR SELECT TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_deck_items insert own" ON public.flashcard_deck_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_deck_items update own" ON public.flashcard_deck_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin())
  WITH CHECK (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "flashcard_deck_items delete own" ON public.flashcard_deck_items
  FOR DELETE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());

CREATE OR REPLACE FUNCTION public.save_flashcard_deck(
  p_deck_id TEXT,
  p_name TEXT,
  p_color TEXT,
  p_config JSONB DEFAULT '{}'::JSONB,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS public.flashcard_decks
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  request_user TEXT;
  saved_row public.flashcard_decks;
  item JSONB;
  item_kind TEXT;
  item_id TEXT;
  item_position INTEGER := 0;
BEGIN
  request_user := public.request_user_id(NULL);

  IF NULLIF(p_deck_id, '') IS NULL THEN
    RAISE EXCEPTION 'flashcard deck id is required';
  END IF;

  INSERT INTO public.flashcard_decks(id, user_id, name, color, config)
  VALUES (
    p_deck_id,
    request_user,
    COALESCE(NULLIF(BTRIM(p_name), ''), 'Baralho'),
    COALESCE(NULLIF(BTRIM(p_color), ''), 'indigo'),
    COALESCE(p_config, '{}'::JSONB)
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color = EXCLUDED.color,
    config = EXCLUDED.config,
    updated_at = NOW()
  WHERE public.flashcard_decks.user_id = request_user OR public.is_app_admin()
  RETURNING * INTO saved_row;

  IF saved_row.id IS NULL THEN
    RAISE EXCEPTION 'flashcard deck not found or not owned by current user';
  END IF;

  DELETE FROM public.flashcard_deck_items
  WHERE deck_id = saved_row.id
    AND (user_id = request_user OR public.is_app_admin());

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    item_kind := item->>'item_type';
    item_id := item->>'item_id';
    IF item_kind IN ('word', 'sentence') AND NULLIF(item_id, '') IS NOT NULL THEN
      INSERT INTO public.flashcard_deck_items(deck_id, user_id, item_type, item_id, position)
      VALUES (saved_row.id, request_user, item_kind, item_id, item_position)
      ON CONFLICT (deck_id, item_type, item_id) DO UPDATE SET
        position = EXCLUDED.position;
      item_position := item_position + 1;
    END IF;
  END LOOP;

  RETURN saved_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_flashcard_deck(TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated, service_role;

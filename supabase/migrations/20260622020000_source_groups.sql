CREATE TABLE IF NOT EXISTS public.source_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  parent_id UUID REFERENCES public.source_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'indigo',
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE IF NOT EXISTS public.source_group_memberships (
  user_id TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES public.source_groups(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_source_groups_user_parent_position
  ON public.source_groups(user_id, parent_id, position, name);
CREATE INDEX IF NOT EXISTS idx_source_group_memberships_user_source
  ON public.source_group_memberships(user_id, source_id);
CREATE INDEX IF NOT EXISTS idx_source_group_memberships_user_group
  ON public.source_group_memberships(user_id, group_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_source_groups_touch') THEN
    CREATE TRIGGER tr_source_groups_touch
      BEFORE UPDATE ON public.source_groups
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.source_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_group_memberships FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.source_groups FROM anon;
REVOKE ALL ON public.source_groups FROM authenticated;
REVOKE ALL ON public.source_group_memberships FROM anon;
REVOKE ALL ON public.source_group_memberships FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_group_memberships TO authenticated;

DROP POLICY IF EXISTS "source_groups select own" ON public.source_groups;
DROP POLICY IF EXISTS "source_groups insert own" ON public.source_groups;
DROP POLICY IF EXISTS "source_groups update own" ON public.source_groups;
DROP POLICY IF EXISTS "source_groups delete own" ON public.source_groups;
CREATE POLICY "source_groups select own" ON public.source_groups
  FOR SELECT TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "source_groups insert own" ON public.source_groups
  FOR INSERT TO authenticated WITH CHECK (
    (user_id = auth.uid()::TEXT OR public.is_app_admin())
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.source_groups parent
        WHERE parent.id = source_groups.parent_id
          AND (parent.user_id = auth.uid()::TEXT OR public.is_app_admin())
      )
    )
  );
CREATE POLICY "source_groups update own" ON public.source_groups
  FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin())
  WITH CHECK (
    (user_id = auth.uid()::TEXT OR public.is_app_admin())
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.source_groups parent
        WHERE parent.id = source_groups.parent_id
          AND (parent.user_id = auth.uid()::TEXT OR public.is_app_admin())
      )
    )
  );
CREATE POLICY "source_groups delete own" ON public.source_groups
  FOR DELETE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());

DROP POLICY IF EXISTS "source_group_memberships select own" ON public.source_group_memberships;
DROP POLICY IF EXISTS "source_group_memberships insert own" ON public.source_group_memberships;
DROP POLICY IF EXISTS "source_group_memberships update own" ON public.source_group_memberships;
DROP POLICY IF EXISTS "source_group_memberships delete own" ON public.source_group_memberships;
CREATE POLICY "source_group_memberships select own" ON public.source_group_memberships
  FOR SELECT TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());
CREATE POLICY "source_group_memberships insert own" ON public.source_group_memberships
  FOR INSERT TO authenticated WITH CHECK (
    (user_id = auth.uid()::TEXT OR public.is_app_admin())
    AND EXISTS (
      SELECT 1 FROM public.source_groups sg
      WHERE sg.id = group_id
        AND (sg.user_id = auth.uid()::TEXT OR public.is_app_admin())
    )
    AND EXISTS (
      SELECT 1 FROM public.sources src
      WHERE src.id = source_id
        AND (src.user_id = auth.uid()::TEXT OR public.is_app_admin())
    )
  );
CREATE POLICY "source_group_memberships update own" ON public.source_group_memberships
  FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin())
  WITH CHECK (
    (user_id = auth.uid()::TEXT OR public.is_app_admin())
    AND EXISTS (
      SELECT 1 FROM public.source_groups sg
      WHERE sg.id = group_id
        AND (sg.user_id = auth.uid()::TEXT OR public.is_app_admin())
    )
    AND EXISTS (
      SELECT 1 FROM public.sources src
      WHERE src.id = source_id
        AND (src.user_id = auth.uid()::TEXT OR public.is_app_admin())
    )
  );
CREATE POLICY "source_group_memberships delete own" ON public.source_group_memberships
  FOR DELETE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin());

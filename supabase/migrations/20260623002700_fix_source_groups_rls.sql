-- Migration: fix source_groups insert/update RLS policies to prevent nested folder error
DROP POLICY IF EXISTS "source_groups insert own" ON public.source_groups;
CREATE POLICY "source_groups insert own" ON public.source_groups
  FOR INSERT TO authenticated WITH CHECK (
    (user_id = auth.uid()::TEXT OR public.is_app_admin())
    AND (
      parent_id IS NULL
      OR parent_id IN (
        SELECT id FROM public.source_groups
        WHERE user_id = auth.uid()::TEXT OR public.is_app_admin()
      )
    )
  );

DROP POLICY IF EXISTS "source_groups update own" ON public.source_groups;
CREATE POLICY "source_groups update own" ON public.source_groups
  FOR UPDATE TO authenticated USING (user_id = auth.uid()::TEXT OR public.is_app_admin())
  WITH CHECK (
    (user_id = auth.uid()::TEXT OR public.is_app_admin())
    AND (
      parent_id IS NULL
      OR parent_id IN (
        SELECT id FROM public.source_groups
        WHERE user_id = auth.uid()::TEXT OR public.is_app_admin()
      )
    )
  );

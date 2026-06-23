-- EXECUTE ESTE SQL NO SQL EDITOR DO SUPABASE PARA CORRIGIR A POLICY RLS DE GRUPOS ANINHADOS:

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

-- =========================================================
-- NIHONGO LOOP — SEGURANÇA SUPABASE / USUÁRIO ÚNICO ADMIN
-- =========================================================
-- Modelo:
-- - Signup pode continuar aberto.
-- - Apenas o usuário cadastrado em public.app_admins pode acessar/modificar dados.
-- - O bootstrap abaixo adiciona o usuário cujo e-mail é gutookada@gmail.com.
-- - Usuários comuns autenticados ficam sem acesso às tabelas do app.
-- - anon fica sem acesso.
--
-- IMPORTANTE:
-- 1. Crie e confirme antes a conta gutookada@gmail.com no Supabase Auth.
-- 2. Rode este SQL no Supabase SQL Editor.
-- 3. Este script remove policies antigas das tabelas listadas e cria policies novas.
-- =========================================================


-- =========================================================
-- 1. TABELA DE ADMINS DO APP
-- =========================================================

create table if not exists public.app_admins (
  user_id uuid primary key,
  email text,
  created_at timestamp with time zone default now()
);

alter table public.app_admins enable row level security;
alter table public.app_admins no force row level security;

comment on table public.app_admins is
'Lista de usuários autorizados a usar/modificar o Nihongo Loop. Controle por auth.uid().';


-- =========================================================
-- 2. INSERIR O ADMIN PRINCIPAL PELO E-MAIL
-- =========================================================
-- Se a conta ainda não existir em auth.users, este bloco apenas avisa.
-- Depois de criar/confirmar a conta, rode este bloco novamente.

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = lower('gutookada@gmail.com')
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise notice 'Usuário gutookada@gmail.com ainda não existe em auth.users. Crie/confirme a conta e rode este SQL novamente.';
  else
    insert into public.app_admins (user_id, email)
    values (v_user_id, 'gutookada@gmail.com')
    on conflict (user_id) do update
      set email = excluded.email;

    raise notice 'Admin cadastrado/confirmado em app_admins: %', v_user_id;
  end if;
end $$;


-- =========================================================
-- 3. FUNÇÃO HELPER PARA POLICIES
-- =========================================================
-- Usa auth.uid(), não e-mail do JWT.
-- É mais seguro e estável: se o e-mail mudar, o user_id continua sendo o mesmo.

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_admins aa
    where aa.user_id = auth.uid()
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;


-- =========================================================
-- 4. PROTEGER A PRÓPRIA TABELA app_admins
-- =========================================================
-- O app não precisa modificar app_admins pelo cliente.
-- A administração deve ser feita pelo SQL Editor.

revoke all on public.app_admins from anon;
revoke all on public.app_admins from authenticated;

drop policy if exists "app admins select only admins" on public.app_admins;
drop policy if exists "app admins insert only admins" on public.app_admins;
drop policy if exists "app admins update only admins" on public.app_admins;
drop policy if exists "app admins delete only admins" on public.app_admins;


-- =========================================================
-- 5. AJUSTES DE SCHEMA QUE O APP ATUAL USA
-- =========================================================
-- Proteção contra erro se o schema.sql ainda estiver defasado.

alter table if exists public.ai_jobs
add column if not exists updated_at timestamp with time zone default now();

alter table if exists public.ai_jobs
add column if not exists locked_by text;

alter table if exists public.ai_jobs
add column if not exists locked_until timestamp with time zone;

alter table if exists public.ai_jobs
add column if not exists retry_count integer default 0;

alter table if exists public.ai_jobs
add column if not exists last_heartbeat_at timestamp with time zone;

alter table if exists public.processing_runs
add column if not exists run_mode text default 'all';


-- =========================================================
-- 6. TABELAS PRINCIPAIS DO NIHONGO LOOP
-- =========================================================
-- Se alguma tabela da lista não existir, o script ignora.

do $$
declare
  t text;
  tables text[] := array[
    'sources',
    'sentences',
    'sentence_terms',
    'dictionary_entries',
    'sentence_progress',
    'dictionary_progress',
    'ai_jobs',
    'study_sessions',
    'processing_runs'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);

      execute format('revoke all on public.%I from anon', t);
      execute format('revoke all on public.%I from authenticated', t);

      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    else
      raise notice 'Tabela public.% não existe; ignorando.', t;
    end if;
  end loop;
end $$;


-- =========================================================
-- 7. REMOVER POLICIES ANTIGAS DAS TABELAS DO APP
-- =========================================================
-- Isto é intencional: policies antigas poderiam permitir acesso por user_id,
-- por anon, ou por regra antiga insegura.
-- Se você tiver alguma policy especial que queira manter, revise antes.

do $$
declare
  r record;
  target_tables text[] := array[
    'sources',
    'sentences',
    'sentence_terms',
    'dictionary_entries',
    'sentence_progress',
    'dictionary_progress',
    'ai_jobs',
    'study_sessions',
    'processing_runs'
  ];
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(target_tables)
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );
  end loop;
end $$;


-- =========================================================
-- 8. CRIAR POLICIES NOVAS: SÓ APP ADMIN ACESSA
-- =========================================================

do $$
declare
  t text;
  tables text[] := array[
    'sources',
    'sentences',
    'sentence_terms',
    'dictionary_entries',
    'sentence_progress',
    'dictionary_progress',
    'ai_jobs',
    'study_sessions',
    'processing_runs'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then

      execute format(
        'create policy %I on public.%I for select to authenticated using ((select public.is_app_admin()))',
        'app admin select ' || t,
        t
      );

      execute format(
        'create policy %I on public.%I for insert to authenticated with check ((select public.is_app_admin()))',
        'app admin insert ' || t,
        t
      );

      execute format(
        'create policy %I on public.%I for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()))',
        'app admin update ' || t,
        t
      );

      execute format(
        'create policy %I on public.%I for delete to authenticated using ((select public.is_app_admin()))',
        'app admin delete ' || t,
        t
      );

    end if;
  end loop;
end $$;


-- =========================================================
-- 9. SEQUENCES, CASO EXISTAM
-- =========================================================
-- Suas tabelas parecem usar UUID, mas deixo seguro caso alguma sequence exista.

grant usage, select on all sequences in schema public to authenticated;
revoke all on all sequences in schema public from anon;


-- =========================================================
-- 10. DEFAULT PRIVILEGES PARA FUTURAS TABELAS
-- =========================================================
-- Atenção: isto não cria RLS automaticamente em futuras tabelas.
-- Sempre que criar tabela nova, ative RLS e crie policies.

alter default privileges in schema public
revoke all on tables from anon;

alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;

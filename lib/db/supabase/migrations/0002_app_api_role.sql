-- Least privilege for the API server. It used to connect as `postgres`, which has BYPASSRLS, so RLS never applied to it.
-- app_api can log in, only read and write the app's tables, can't bypass RLS, can't change the schema, and can't see the
-- auth schema. Its password is set outside git by `pnpm --filter @workspace/scripts run db:app-role`.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_api;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'demo\_%' LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_api', t);
    -- RLS stays on; this policy lets only the API role through. anon/authenticated still match no policy.
    EXECUTE format('DROP POLICY IF EXISTS app_api_all ON public.%I', t);
    EXECUTE format('CREATE POLICY app_api_all ON public.%I FOR ALL TO app_api USING (true) WITH CHECK (true)', t);
    -- The browser never talks to these tables through Supabase's Data API: take away its grants too (RLS was the only wall).
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

REVOKE ALL ON public.user_roles, public.app_migrations FROM anon, authenticated;

-- Tables made by later migrations start with no Data API access and with app_api's read/write grant (each still needs its
-- app_api_all policy, which the migration adds).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;

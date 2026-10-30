-- demo_admin_profiles (app migration 0005): only the API role reads or writes it, like every other app table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_admin_profiles TO app_api;
DROP POLICY IF EXISTS app_api_all ON public.demo_admin_profiles;
CREATE POLICY app_api_all ON public.demo_admin_profiles FOR ALL TO app_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.demo_admin_profiles FROM anon, authenticated;

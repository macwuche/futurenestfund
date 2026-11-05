-- demo_industries and demo_grant_plans (app migration 0011): only the API role reads or writes them, like every other app table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_industries, public.demo_grant_plans TO app_api;
DROP POLICY IF EXISTS app_api_all ON public.demo_industries;
CREATE POLICY app_api_all ON public.demo_industries FOR ALL TO app_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS app_api_all ON public.demo_grant_plans;
CREATE POLICY app_api_all ON public.demo_grant_plans FOR ALL TO app_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.demo_industries, public.demo_grant_plans FROM anon, authenticated;

-- demo_tier_requests (app migration 0012): only the API role reads or writes it, like every other app table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_tier_requests TO app_api;
DROP POLICY IF EXISTS app_api_all ON public.demo_tier_requests;
CREATE POLICY app_api_all ON public.demo_tier_requests FOR ALL TO app_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.demo_tier_requests FROM anon, authenticated;

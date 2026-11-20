-- demo_payment_cards and demo_reported_cards (app migration 0015): only the API role reads or writes them, like every other app table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_payment_cards TO app_api;
DROP POLICY IF EXISTS app_api_all ON public.demo_payment_cards;
CREATE POLICY app_api_all ON public.demo_payment_cards FOR ALL TO app_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.demo_payment_cards FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_reported_cards TO app_api;
DROP POLICY IF EXISTS app_api_all ON public.demo_reported_cards;
CREATE POLICY app_api_all ON public.demo_reported_cards FOR ALL TO app_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.demo_reported_cards FROM anon, authenticated;

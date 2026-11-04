-- demo_payment_methods (app migration 0009): only the API role reads or writes it, like every other app table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_payment_methods TO app_api;
DROP POLICY IF EXISTS app_api_all ON public.demo_payment_methods;
CREATE POLICY app_api_all ON public.demo_payment_methods FOR ALL TO app_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.demo_payment_methods FROM anon, authenticated;

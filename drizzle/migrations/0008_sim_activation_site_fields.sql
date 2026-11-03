ALTER TABLE public.sim_activations ADD COLUMN IF NOT EXISTS site_id text;
ALTER TABLE public.sim_activations ADD COLUMN IF NOT EXISTS equipment text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.sim_activations.site_id IS 'Site ID entered at activation time.';
COMMENT ON COLUMN public.sim_activations.equipment IS 'Equipment ticked at activation: ur35, gps_battery, gps_genset.';
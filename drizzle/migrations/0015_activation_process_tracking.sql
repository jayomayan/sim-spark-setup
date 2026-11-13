ALTER TABLE public.sim_activations
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sim_activated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sim_paused boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sim_activations_open_idx ON public.sim_activations (status, last_activity_at) WHERE finished_at IS NULL;
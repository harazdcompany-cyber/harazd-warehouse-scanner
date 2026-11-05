-- HARAZD WAREHOUSE V49.34 | Events: stage 1
-- Run ONCE in Supabase SQL Editor as the database administrator.
BEGIN;
CREATE TABLE IF NOT EXISTS public.warehouse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  client text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  setup_date date,
  event_date date NOT NULL,
  teardown_date date,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','preparation','installation','live','dismantling','done','cancelled')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_date_order CHECK ((setup_date IS NULL OR setup_date <= event_date) AND (teardown_date IS NULL OR teardown_date >= event_date))
);
CREATE INDEX IF NOT EXISTS warehouse_events_date_idx ON public.warehouse_events(event_date);
ALTER TABLE public.warehouse_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.warehouse_events TO authenticated;
REVOKE ALL ON public.warehouse_events FROM anon;
DROP POLICY IF EXISTS events_read ON public.warehouse_events;
CREATE POLICY events_read ON public.warehouse_events FOR SELECT TO authenticated
 USING (public.warehouse_can('events_create') OR public.warehouse_can('events_edit'));
DROP POLICY IF EXISTS events_insert ON public.warehouse_events;
CREATE POLICY events_insert ON public.warehouse_events FOR INSERT TO authenticated
 WITH CHECK (public.warehouse_can('events_create') AND created_by=auth.uid());
DROP POLICY IF EXISTS events_update ON public.warehouse_events;
CREATE POLICY events_update ON public.warehouse_events FOR UPDATE TO authenticated
 USING (public.warehouse_can('events_edit')) WITH CHECK (public.warehouse_can('events_edit'));
-- First stage intentionally has no DELETE policy or client-side deletion control.
CREATE OR REPLACE FUNCTION public.warehouse_events_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); NEW.created_by=OLD.created_by; NEW.created_at=OLD.created_at; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS warehouse_events_timestamp_trigger ON public.warehouse_events;
CREATE TRIGGER warehouse_events_timestamp_trigger BEFORE UPDATE ON public.warehouse_events
FOR EACH ROW EXECUTE FUNCTION public.warehouse_events_timestamp();
NOTIFY pgrst,'reload schema';
COMMIT;

-- HARAZD WAREHOUSE: vehicles and event-specific drivers.
-- Run once in the Supabase SQL Editor after SETUP_EVENTS_V49_34.sql and SETUP_VEHICLES.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.warehouse_event_vehicles (
  event_id uuid NOT NULL REFERENCES public.warehouse_events(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  driver_user_id uuid REFERENCES public.warehouse_staff(user_id) ON DELETE SET NULL,
  driver_name text CHECK (driver_name IS NULL OR char_length(driver_name) <= 160),
  PRIMARY KEY (event_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS warehouse_event_vehicles_vehicle_idx ON public.warehouse_event_vehicles(vehicle_id);
ALTER TABLE public.warehouse_event_vehicles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_event_vehicles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_event_vehicles TO authenticated;
DROP POLICY IF EXISTS event_vehicles_read ON public.warehouse_event_vehicles;
CREATE POLICY event_vehicles_read ON public.warehouse_event_vehicles FOR SELECT TO authenticated
  USING (public.warehouse_can('events_create') OR public.warehouse_can('events_edit'));
DROP POLICY IF EXISTS event_vehicles_insert ON public.warehouse_event_vehicles;
CREATE POLICY event_vehicles_insert ON public.warehouse_event_vehicles FOR INSERT TO authenticated
  WITH CHECK (public.warehouse_can('events_edit'));
DROP POLICY IF EXISTS event_vehicles_update ON public.warehouse_event_vehicles;
CREATE POLICY event_vehicles_update ON public.warehouse_event_vehicles FOR UPDATE TO authenticated
  USING (public.warehouse_can('events_edit')) WITH CHECK (public.warehouse_can('events_edit'));
DROP POLICY IF EXISTS event_vehicles_delete ON public.warehouse_event_vehicles;
CREATE POLICY event_vehicles_delete ON public.warehouse_event_vehicles FOR DELETE TO authenticated
  USING (public.warehouse_can('events_edit'));
NOTIFY pgrst, 'reload schema';
COMMIT;

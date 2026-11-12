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

-- Atomically replace the selected vehicles; keep existing event-specific drivers.
CREATE OR REPLACE FUNCTION public.warehouse_set_event_vehicles(
  p_event_id uuid, p_vehicle_ids uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $event_vehicle$
BEGIN
  IF p_event_id IS NULL OR p_vehicle_ids IS NULL OR array_position(p_vehicle_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Необхідно вказати івент та коректний список автомобілів';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouse_events e
    WHERE e.id = p_event_id AND (
      public.warehouse_can('events_edit') OR
      (public.warehouse_can('events_create') AND e.created_by = auth.uid())
    )
  ) THEN
    RAISE EXCEPTION 'Немає доступу до призначення автомобілів';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_vehicle_ids) AS chosen(vehicle_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.fleet_vehicles v WHERE v.id = chosen.vehicle_id)
  ) THEN
    RAISE EXCEPTION 'Один з автомобілів не знайдено';
  END IF;
  DELETE FROM public.warehouse_event_vehicles existing
    WHERE existing.event_id = p_event_id
      AND NOT (existing.vehicle_id = ANY(p_vehicle_ids));
  INSERT INTO public.warehouse_event_vehicles(event_id, vehicle_id, driver_name)
    SELECT p_event_id, v.id, NULLIF(btrim(v.driver), '')
    FROM public.fleet_vehicles v
    WHERE v.id = ANY(p_vehicle_ids)
    ON CONFLICT (event_id, vehicle_id) DO NOTHING;
END;
$event_vehicle$;
REVOKE ALL ON FUNCTION public.warehouse_set_event_vehicles(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.warehouse_set_event_vehicles(uuid,uuid[]) TO authenticated;


-- Atomically save selected vehicles and event-specific driver assignments.
CREATE OR REPLACE FUNCTION public.warehouse_set_event_vehicles_with_drivers(
  p_event_id uuid, p_vehicles jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $event_vehicle_drivers$
BEGIN
  IF p_event_id IS NULL OR jsonb_typeof(p_vehicles) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Необхідно вказати івент і список автомобілів';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouse_events e WHERE e.id = p_event_id AND (
      public.warehouse_can('events_edit') OR
      (public.warehouse_can('events_create') AND e.created_by = auth.uid())
    )
  ) THEN
    RAISE EXCEPTION 'Немає доступу до призначення автомобілів';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_vehicles)
      AS chosen(vehicle_id uuid, driver_user_id uuid, driver_name text)
    WHERE chosen.vehicle_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.fleet_vehicles v WHERE v.id = chosen.vehicle_id)
       OR (chosen.driver_user_id IS NOT NULL AND NOT EXISTS
           (SELECT 1 FROM public.warehouse_staff s WHERE s.user_id = chosen.driver_user_id))
       OR char_length(chosen.driver_name) > 160
  ) THEN
    RAISE EXCEPTION 'Некоректний автомобіль або водій';
  END IF;
  IF (SELECT count(*) FROM jsonb_to_recordset(p_vehicles)
      AS chosen(vehicle_id uuid, driver_user_id uuid, driver_name text)) <>
     (SELECT count(DISTINCT chosen.vehicle_id) FROM jsonb_to_recordset(p_vehicles)
      AS chosen(vehicle_id uuid, driver_user_id uuid, driver_name text)) THEN
    RAISE EXCEPTION 'Автомобіль вибрано більше одного разу';
  END IF;
  DELETE FROM public.warehouse_event_vehicles existing
    WHERE existing.event_id = p_event_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_vehicles)
          AS chosen(vehicle_id uuid, driver_user_id uuid, driver_name text)
        WHERE chosen.vehicle_id = existing.vehicle_id
      );
  INSERT INTO public.warehouse_event_vehicles(event_id, vehicle_id, driver_user_id, driver_name)
    SELECT p_event_id, chosen.vehicle_id, chosen.driver_user_id,
      CASE WHEN chosen.driver_user_id IS NOT NULL THEN staff.full_name
           ELSE NULLIF(btrim(chosen.driver_name), '') END
    FROM jsonb_to_recordset(p_vehicles)
      AS chosen(vehicle_id uuid, driver_user_id uuid, driver_name text)
    LEFT JOIN public.warehouse_staff staff ON staff.user_id = chosen.driver_user_id
    ON CONFLICT (event_id, vehicle_id) DO UPDATE
      SET driver_user_id = EXCLUDED.driver_user_id, driver_name = EXCLUDED.driver_name;
END;
$event_vehicle_drivers$;
REVOKE ALL ON FUNCTION public.warehouse_set_event_vehicles_with_drivers(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.warehouse_set_event_vehicles_with_drivers(uuid,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

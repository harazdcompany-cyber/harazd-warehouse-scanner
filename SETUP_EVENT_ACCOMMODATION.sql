-- HARAZD WAREHOUSE: event accommodation.
-- Run in Supabase SQL Editor after SETUP_EVENTS_V49_34.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.warehouse_event_accommodation (
  event_id uuid PRIMARY KEY REFERENCES public.warehouse_events(id) ON DELETE CASCADE,
  hotel_name text NOT NULL DEFAULT '' CHECK (char_length(hotel_name) <= 200),
  check_in date,
  check_out date,
  address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 500),
  guest_count integer CHECK (guest_count IS NULL OR guest_count BETWEEN 0 AND 9999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_in IS NULL OR check_out IS NULL OR check_out >= check_in)
);
ALTER TABLE public.warehouse_event_accommodation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_event_accommodation FROM anon, authenticated;
GRANT SELECT ON public.warehouse_event_accommodation TO authenticated;
DROP POLICY IF EXISTS event_accommodation_read ON public.warehouse_event_accommodation;
CREATE POLICY event_accommodation_read ON public.warehouse_event_accommodation FOR SELECT TO authenticated
  USING (public.warehouse_can('events_create') OR public.warehouse_can('events_edit'));

CREATE OR REPLACE FUNCTION public.warehouse_set_event_accommodation(
  p_event_id uuid, p_hotel_name text, p_check_in date, p_check_out date,
  p_address text, p_guest_count integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $event_accommodation$
BEGIN
  IF p_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouse_events e WHERE e.id = p_event_id AND (
      public.warehouse_can('events_edit') OR
      (public.warehouse_can('events_create') AND e.created_by = auth.uid())
    )
  ) THEN
    RAISE EXCEPTION 'Немає доступу до проживання цього івенту';
  END IF;
  IF char_length(COALESCE(p_hotel_name, '')) > 200
     OR char_length(COALESCE(p_address, '')) > 500
     OR (p_guest_count IS NOT NULL AND (p_guest_count < 0 OR p_guest_count > 9999))
     OR (p_check_in IS NOT NULL AND p_check_out IS NOT NULL AND p_check_out < p_check_in) THEN
    RAISE EXCEPTION 'Некоректні дані проживання';
  END IF;
  INSERT INTO public.warehouse_event_accommodation(event_id,hotel_name,check_in,check_out,address,guest_count,updated_at)
    VALUES (p_event_id,btrim(COALESCE(p_hotel_name,'')),p_check_in,p_check_out,btrim(COALESCE(p_address,'')),p_guest_count,now())
    ON CONFLICT (event_id) DO UPDATE SET
      hotel_name=EXCLUDED.hotel_name, check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
      address=EXCLUDED.address, guest_count=EXCLUDED.guest_count, updated_at=now();
END;
$event_accommodation$;
REVOKE ALL ON FUNCTION public.warehouse_set_event_accommodation(uuid,text,date,date,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.warehouse_set_event_accommodation(uuid,text,date,date,text,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

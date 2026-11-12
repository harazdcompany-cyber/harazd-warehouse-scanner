-- Commercial prices for the event's shared equipment/loading list.
-- Run once in the Supabase SQL Editor.
BEGIN;
CREATE TABLE IF NOT EXISTS public.warehouse_event_quote_prices (
  event_id uuid NOT NULL REFERENCES public.warehouse_events(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  unit text NOT NULL DEFAULT 'шт.' CHECK (length(unit) BETWEEN 1 AND 30),
  unit_price numeric(14,2) DEFAULT NULL CHECK (unit_price IS NULL OR (unit_price >= 0 AND unit_price <= 999999999)),
  days integer NOT NULL DEFAULT 1 CHECK (days BETWEEN 1 AND 9999),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  vat_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK (vat_percent BETWEEN 0 AND 100),
  PRIMARY KEY (event_id,equipment_id)
);
ALTER TABLE public.warehouse_event_quote_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_event_quote_prices FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_event_quote_prices TO authenticated;
DROP POLICY IF EXISTS event_quote_read ON public.warehouse_event_quote_prices;
CREATE POLICY event_quote_read ON public.warehouse_event_quote_prices FOR SELECT TO authenticated
  USING (public.warehouse_can('events_edit') OR public.warehouse_can('events_create'));
DROP POLICY IF EXISTS event_quote_insert ON public.warehouse_event_quote_prices;
CREATE POLICY event_quote_insert ON public.warehouse_event_quote_prices FOR INSERT TO authenticated
  WITH CHECK (public.warehouse_can('events_edit') AND EXISTS (
    SELECT 1 FROM public.warehouse_event_equipment w
    WHERE w.event_id=warehouse_event_quote_prices.event_id AND w.equipment_id=warehouse_event_quote_prices.equipment_id
  ));
DROP POLICY IF EXISTS event_quote_update ON public.warehouse_event_quote_prices;
CREATE POLICY event_quote_update ON public.warehouse_event_quote_prices FOR UPDATE TO authenticated
  USING (public.warehouse_can('events_edit'))
  WITH CHECK (public.warehouse_can('events_edit') AND EXISTS (
    SELECT 1 FROM public.warehouse_event_equipment w
    WHERE w.event_id=warehouse_event_quote_prices.event_id AND w.equipment_id=warehouse_event_quote_prices.equipment_id
  ));
DROP POLICY IF EXISTS event_quote_delete ON public.warehouse_event_quote_prices;
CREATE POLICY event_quote_delete ON public.warehouse_event_quote_prices FOR DELETE TO authenticated
  USING (public.warehouse_can('events_edit'));
NOTIFY pgrst,'reload schema';
COMMIT;

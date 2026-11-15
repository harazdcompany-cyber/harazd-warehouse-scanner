-- HARAZD WAREHOUSE · Delete an event and its event-specific records.
-- Run ONCE in Supabase SQL Editor after SETUP_EVENTS_V49_34.sql.
-- The shared warehouse equipment, employees and fleet vehicles are NOT deleted.
BEGIN;

GRANT DELETE ON public.warehouse_events TO authenticated;
DROP POLICY IF EXISTS events_delete ON public.warehouse_events;
CREATE POLICY events_delete ON public.warehouse_events
  FOR DELETE TO authenticated
  USING (public.warehouse_can('events_edit'));

-- Some older installations may have RESTRICT / NO ACTION event foreign keys.
-- Convert only the event_id FK of known event-specific tables to CASCADE.
-- Do not modify foreign keys to equipment, warehouse_staff or fleet_vehicles.
DO $$
DECLARE
  child_table text;
  fk record;
  suffix text;
BEGIN
  FOREACH child_table IN ARRAY ARRAY[
    'warehouse_event_equipment',
    'warehouse_event_staff',
    'warehouse_event_vehicles',
    'warehouse_event_accommodation',
    'warehouse_event_quote_prices',
    'warehouse_event_quote_authors'
  ] LOOP
    IF to_regclass(format('public.%I',child_table)) IS NULL THEN CONTINUE; END IF;
    FOR fk IN
      SELECT c.conname, c.condeferrable, c.condeferred
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'event_id'
      WHERE c.contype = 'f'
        AND c.conrelid = to_regclass(format('public.%I',child_table))
        AND c.confrelid = 'public.warehouse_events'::regclass
        AND c.conkey = ARRAY[a.attnum]::smallint[]
        AND c.confdeltype IN ('a','r')
    LOOP
      suffix := CASE WHEN fk.condeferrable THEN
        CASE WHEN fk.condeferred THEN ' DEFERRABLE INITIALLY DEFERRED'
             ELSE ' DEFERRABLE INITIALLY IMMEDIATE' END
        ELSE ' NOT DEFERRABLE' END;
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',child_table,fk.conname);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (event_id) REFERENCES public.warehouse_events(id) ON DELETE CASCADE%s',child_table,fk.conname,suffix);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

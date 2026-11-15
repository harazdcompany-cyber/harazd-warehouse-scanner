-- HARAZD WAREHOUSE: exact times for the five event work periods.
-- Execute once in Supabase SQL Editor; original event dates and existing rows stay untouched.
-- NULL start/end times mean "Весь день" in the weekly calendar.
BEGIN;

ALTER TABLE public.warehouse_events
  ADD COLUMN IF NOT EXISTS warehouse_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS warehouse_end_time time without time zone,
  ADD COLUMN IF NOT EXISTS setup_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS setup_end_time time without time zone,
  ADD COLUMN IF NOT EXISTS event_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS event_end_time time without time zone,
  ADD COLUMN IF NOT EXISTS teardown_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS teardown_end_time time without time zone,
  ADD COLUMN IF NOT EXISTS post_warehouse_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS post_warehouse_end_time time without time zone;

-- The editor validates start/end time pairs. Keep old rows nullable for full-day display.
NOTIFY pgrst,'reload schema';
COMMIT;

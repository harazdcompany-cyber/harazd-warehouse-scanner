-- HARAZD WAREHOUSE V47.2: автоматичні коди при створенні обладнання.
-- Виконати один раз у Supabase SQL Editor. Існуючі коди не змінюються.
BEGIN;
CREATE OR REPLACE FUNCTION public.fill_equipment_codes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  -- EQ-ID вже створений базою під час INSERT.
  -- Коди, введені раніше, залишаємо без змін.
  UPDATE public.equipment
  SET barcode = COALESCE(NULLIF(barcode, ''), NEW.eq_id),
      qr = COALESCE(NULLIF(qr, ''), NEW.eq_id)
  WHERE id = NEW.id AND (NULLIF(barcode, '') IS NULL OR NULLIF(qr, '') IS NULL);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS equipment_autocodes_insert ON public.equipment;
CREATE TRIGGER equipment_autocodes_insert
AFTER INSERT ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.fill_equipment_codes();
COMMIT;

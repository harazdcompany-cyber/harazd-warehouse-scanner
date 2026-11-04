-- HARAZD WAREHOUSE: safe move of packaging containing partial quantitative stock.
-- Run in Supabase SQL Editor. Existing packaging and equipment records are preserved.
-- For partially packaged equipment, equipment.warehouse_id/location_id remains
-- the location of the UNPACKAGED balance; the view below exposes both balances.

CREATE OR REPLACE FUNCTION public.packaging_move_with_contents(
 p_packaging_id uuid, p_location_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
 v_warehouse uuid;
 v_zone text;
 v_rack text;
 v_shelf text;
 v_location text;
 v_invalid integer;
BEGIN
 IF NOT public.warehouse_can('equipment_edit') THEN
  RAISE EXCEPTION 'Немає дозволу редагувати обладнання';
 END IF;
 SELECT warehouse_id INTO v_warehouse
 FROM public.storage_locations WHERE id=p_location_id AND kind='place';
 IF v_warehouse IS NULL THEN
  RAISE EXCEPTION 'Оберіть кінцеве місце з довідника';
 END IF;
 PERFORM 1 FROM public.packaging WHERE id=p_packaging_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Пакування не знайдено'; END IF;

 WITH RECURSIVE chain AS (
  SELECT id,parent_id,kind,name FROM public.storage_locations WHERE id=p_location_id
  UNION ALL
  SELECT p.id,p.parent_id,p.kind,p.name
  FROM public.storage_locations p JOIN chain c ON p.id=c.parent_id
 )
 SELECT max(name) FILTER(WHERE kind='zone'),
        max(name) FILTER(WHERE kind='rack'),
        max(name) FILTER(WHERE kind='shelf')
 INTO v_zone,v_rack,v_shelf FROM chain;
 SELECT concat_ws(' / ',w.name,v_zone,v_rack,v_shelf,l.name)
 INTO v_location
 FROM public.warehouses w CROSS JOIN public.storage_locations l
 WHERE w.id=v_warehouse AND l.id=p_location_id;

 -- Lock involved equipment rows to serialize concurrent stock moves.
 PERFORM 1 FROM public.equipment e WHERE e.id IN (
  WITH RECURSIVE tree AS (
   SELECT id,ARRAY[id] visited FROM public.packaging WHERE id=p_packaging_id
   UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c
   JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
  ) SELECT pc.equipment_id FROM public.packaging_contents pc
  JOIN tree t ON t.id=pc.packaging_id
 ) ORDER BY e.id FOR UPDATE;

 -- Reject invalid allocations instead of moving an inconsistent stock.
 WITH RECURSIVE tree AS (
  SELECT id,ARRAY[id] visited FROM public.packaging WHERE id=p_packaging_id
  UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c
  JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
 ), totals AS (
  SELECT e.id,e.quantity,
    (SELECT coalesce(sum(pc.quantity),0) FROM public.packaging_contents pc
     WHERE pc.equipment_id=e.id) allocated
  FROM public.equipment e WHERE e.id IN (
   SELECT pc.equipment_id FROM public.packaging_contents pc
   JOIN tree t ON t.id=pc.packaging_id
  )
 )
 SELECT count(*) INTO v_invalid FROM totals
 WHERE allocated>quantity OR allocated<0 OR quantity IS NULL;
 IF v_invalid>0 THEN
  RAISE EXCEPTION 'Некоректна кількість обладнання у пакуванні. Перевірте залишки.';
 END IF;

 -- Update the equipment's own location ONLY when the whole stock of this
 -- equipment row is inside the moving tree. Partial quantities stay at
 -- their original stock location; their packed location comes from the view.
 WITH RECURSIVE tree AS (
  SELECT id,ARRAY[id] visited FROM public.packaging WHERE id=p_packaging_id
  UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c
  JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
 ), moving AS (
  SELECT pc.equipment_id,sum(pc.quantity) qty
  FROM public.packaging_contents pc JOIN tree t ON t.id=pc.packaging_id
  GROUP BY pc.equipment_id
 )
 UPDATE public.equipment e
 SET warehouse_id=v_warehouse,location_id=p_location_id,
     zone=v_zone,rack=v_rack,shelf=v_shelf
 FROM moving m
 WHERE e.id=m.equipment_id AND m.qty=e.quantity
   AND NOT EXISTS (
    SELECT 1 FROM public.packaging_contents other
    WHERE other.equipment_id=e.id
      AND other.packaging_id NOT IN(SELECT id FROM tree)
   );

 WITH RECURSIVE tree AS (
  SELECT id,ARRAY[id] visited FROM public.packaging WHERE id=p_packaging_id
  UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c
  JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
 )
 UPDATE public.packaging p
 SET warehouse_id=v_warehouse,location_id=p_location_id,location=v_location
 WHERE p.id IN(SELECT id FROM tree);

 INSERT INTO public.packaging_history(packaging_id,action,details,actor)
 VALUES(p_packaging_id,'LOCATION_MOVE',
  jsonb_build_object('warehouse_id',v_warehouse,'location_id',p_location_id,
    'location',v_location,'partial_stock_location','tracked_separately'),auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.packaging_move_with_contents(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.packaging_move_with_contents(uuid,uuid) TO authenticated;

-- Location-aware quantities, without modifying total equipment.quantity.
-- Equipment rows with partial packing retain their original warehouse/location
-- for the unpackaged remainder. Packed quantities follow packaging.location_id.
CREATE OR REPLACE VIEW public.packaging_equipment_location_balances
WITH (security_invoker=true) AS
WITH packed AS (
 SELECT pc.equipment_id,p.warehouse_id,p.location_id,
        sum(pc.quantity) AS quantity
 FROM public.packaging_contents pc
 JOIN public.packaging p ON p.id=pc.packaging_id
 GROUP BY pc.equipment_id,p.warehouse_id,p.location_id
), totals AS (
 SELECT equipment_id,sum(quantity) packed_qty FROM packed GROUP BY equipment_id
)
SELECT e.id AS equipment_id,e.eq_id,e.name,e.warehouse_id,e.location_id,
       e.quantity-coalesce(t.packed_qty,0) AS quantity,
       'unpacked'::text AS allocation_type
FROM public.equipment e LEFT JOIN totals t ON t.equipment_id=e.id
WHERE e.quantity>coalesce(t.packed_qty,0)
UNION ALL
SELECT e.id,e.eq_id,e.name,p.warehouse_id,p.location_id,p.quantity,
       'packaged'::text
FROM packed p JOIN public.equipment e ON e.id=p.equipment_id;

GRANT SELECT ON public.packaging_equipment_location_balances TO authenticated;
NOTIFY pgrst,'reload schema';

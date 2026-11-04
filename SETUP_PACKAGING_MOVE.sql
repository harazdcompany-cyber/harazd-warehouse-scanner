-- HARAZD WAREHOUSE: execute in Supabase SQL Editor before uploading updated files.
-- Atomic move of a packaging tree and all its actual equipment.
ALTER TABLE public.packaging ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id);
ALTER TABLE public.packaging ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.storage_locations(id);

CREATE OR REPLACE FUNCTION public.packaging_move_with_contents(p_packaging_id uuid,p_location_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_warehouse uuid;v_zone text;v_rack text;v_shelf text;v_location text;v_count integer;
BEGIN
 IF NOT public.warehouse_can('equipment_edit') THEN RAISE EXCEPTION 'Немає дозволу редагувати обладнання';END IF;
 SELECT warehouse_id INTO v_warehouse FROM public.storage_locations WHERE id=p_location_id AND kind='place';
 IF v_warehouse IS NULL THEN RAISE EXCEPTION 'Оберіть кінцеве місце з довідника';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.packaging WHERE id=p_packaging_id) THEN RAISE EXCEPTION 'Пакування не знайдено';END IF;
 -- Avoid concurrent moves of the same root.
 PERFORM 1 FROM public.packaging WHERE id=p_packaging_id FOR UPDATE;
 WITH RECURSIVE chain AS (
  SELECT id,parent_id,kind,name FROM public.storage_locations WHERE id=p_location_id
  UNION ALL SELECT p.id,p.parent_id,p.kind,p.name FROM public.storage_locations p JOIN chain c ON p.id=c.parent_id
 ) SELECT max(name) FILTER(WHERE kind='zone'),max(name) FILTER(WHERE kind='rack'),max(name) FILTER(WHERE kind='shelf') INTO v_zone,v_rack,v_shelf FROM chain;
 SELECT name INTO v_location FROM public.warehouses WHERE id=v_warehouse;
 v_location:=concat_ws(' / ',v_location,v_zone,v_rack,v_shelf,(SELECT name FROM public.storage_locations WHERE id=p_location_id));
 -- Reject aggregate equipment rows split between packaging and other locations.
 -- Updating equipment.warehouse_id on such a row would incorrectly move the entire stock.
 WITH RECURSIVE tree AS (
  SELECT id,ARRAY[id] AS visited FROM public.packaging WHERE id=p_packaging_id
  UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
 ), partial AS (
  SELECT pc.equipment_id,e.quantity AS stock_qty,coalesce(sum(pc.quantity) FILTER(WHERE pc.packaging_id IN(SELECT id FROM tree)),0) AS moving_qty,
         coalesce((SELECT sum(allpc.quantity) FROM public.packaging_contents allpc WHERE allpc.equipment_id=pc.equipment_id),0) AS packaged_qty
  FROM public.packaging_contents pc JOIN public.equipment e ON e.id=pc.equipment_id
  WHERE pc.packaging_id IN(SELECT id FROM tree)
  GROUP BY pc.equipment_id,e.quantity
 ) SELECT count(*) INTO v_count FROM partial WHERE moving_qty<>stock_qty OR packaged_qty<>moving_qty;
 IF v_count>0 THEN RAISE EXCEPTION 'У пакуванні є частина кількісної позиції. Переміщення всього складського запису заборонене; потрібен окремий облік залишків за місцями.';END IF;
 WITH RECURSIVE tree AS (
  SELECT id,ARRAY[id] AS visited FROM public.packaging WHERE id=p_packaging_id
  UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
 ) UPDATE public.equipment e SET warehouse_id=v_warehouse,location_id=p_location_id,zone=v_zone,rack=v_rack,shelf=v_shelf
 WHERE e.id IN(SELECT pc.equipment_id FROM public.packaging_contents pc JOIN tree t ON t.id=pc.packaging_id);
 WITH RECURSIVE tree AS (
  SELECT id,ARRAY[id] AS visited FROM public.packaging WHERE id=p_packaging_id
  UNION ALL SELECT c.id,t.visited||c.id FROM public.packaging c JOIN tree t ON c.parent_id=t.id WHERE NOT c.id=ANY(t.visited)
 ) UPDATE public.packaging p SET warehouse_id=v_warehouse,location_id=p_location_id,location=v_location
 WHERE p.id IN(SELECT id FROM tree);
 IF NOT FOUND THEN RAISE EXCEPTION 'Пакування не оновлено';END IF;
 INSERT INTO public.packaging_history(packaging_id,action,details,actor)
 VALUES(p_packaging_id,'LOCATION_MOVE',jsonb_build_object('warehouse_id',v_warehouse,'location_id',p_location_id,'location',v_location),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.packaging_move_with_contents(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.packaging_move_with_contents(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';

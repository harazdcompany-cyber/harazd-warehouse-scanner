-- HARAZD WAREHOUSE · Immutable commercial-quotation author snapshot.
-- Run ONCE in Supabase SQL Editor after SETUP_EVENT_COMMERCIAL_QUOTE.sql.
-- Existing quotations are not backfilled: their original author cannot be reliably inferred.
BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_event_quote_authors (
  event_id uuid PRIMARY KEY REFERENCES public.warehouse_events(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 160),
  author_phone text NOT NULL DEFAULT '' CHECK (length(author_phone) <= 64),
  author_email text NOT NULL DEFAULT '' CHECK (length(author_email) <= 320),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.warehouse_event_quote_authors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_event_quote_authors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.warehouse_event_quote_authors TO authenticated;

DROP POLICY IF EXISTS quote_authors_read ON public.warehouse_event_quote_authors;
CREATE POLICY quote_authors_read ON public.warehouse_event_quote_authors
FOR SELECT TO authenticated
USING (public.warehouse_can('events_edit') OR public.warehouse_can('events_create'));

-- Authors cannot be replaced by API clients. First editable open claims authorship once.
CREATE OR REPLACE FUNCTION public.warehouse_quote_claim_author(p_event_id uuid)
RETURNS SETOF public.warehouse_event_quote_authors
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text;
  v_phone text := '';
  v_email text := '';
BEGIN
  IF v_user_id IS NULL OR NOT public.warehouse_can('events_edit') THEN
    RAISE EXCEPTION 'Not allowed to create commercial quotations' USING ERRCODE='42501';
  END IF;
  IF p_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.warehouse_events WHERE id=p_event_id) THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE='22023';
  END IF;

  -- Preserve the first saved author even if another employee edits or prints later.
  IF EXISTS (SELECT 1 FROM public.warehouse_event_quote_authors WHERE event_id=p_event_id) THEN
    RETURN QUERY SELECT * FROM public.warehouse_event_quote_authors WHERE event_id=p_event_id;
    RETURN;
  END IF;

  SELECT btrim(s.full_name), COALESCE(NULLIF(btrim(u.email),''),NULLIF(btrim(s.email),''),'')
    INTO v_name,v_email
    FROM public.warehouse_staff s
    LEFT JOIN auth.users u ON u.id=s.user_id
    WHERE s.user_id=v_user_id AND s.status='active';

  IF v_name IS NULL OR v_name='' THEN
    RAISE EXCEPTION 'Active staff profile with a full name is required' USING ERRCODE='22023';
  END IF;

  -- Contact table is maintained by "Моя сторінка"; empty phone is allowed.
  IF to_regclass('public.warehouse_staff_contact') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(phone, '''') FROM public.warehouse_staff_contact WHERE user_id = $1'
    INTO v_phone USING v_user_id;
  END IF;

  INSERT INTO public.warehouse_event_quote_authors
      (event_id,created_by,author_name,author_phone,author_email)
  VALUES (p_event_id,v_user_id,v_name,COALESCE(v_phone,''),v_email)
  ON CONFLICT (event_id) DO NOTHING;

  RETURN QUERY SELECT * FROM public.warehouse_event_quote_authors WHERE event_id=p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_quote_claim_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.warehouse_quote_claim_author(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

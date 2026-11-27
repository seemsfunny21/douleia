-- Deployed 2026-11-27. Keep legacy BG catalog row and all recorded runs.
-- Separate B and G on 2026-11-30; optional COMBO2 must not cause missing-departure alerts.
DO $split$
DECLARE start_def text; push_def text; next_def text; before_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(621127,1);
 SELECT count(*) INTO before_count FROM public.dromologia_routes WHERE code IN ('COMBO2','B','G');
 IF before_count<>0 THEN RAISE EXCEPTION 'New route codes already exist; review manually'; END IF;
 IF (SELECT count(*) FROM public.dromologia_routes WHERE code IN ('COMBO','A','D','BG','PM') AND active)<>5 THEN RAISE EXCEPTION 'Unexpected route catalog'; END IF;
 SELECT pg_get_functiondef('public.dromologia_start(text,uuid)'::regprocedure) INTO start_def;
 next_def:=replace(start_def,' if not exists(select 1 from public.dromologia_routes where code=p_route and active) then raise exception ''Άγνωστο δρομολόγιο.''; end if;', $guard$ if not exists(select 1 from public.dromologia_routes where code=p_route and active) then raise exception 'Άγνωστο δρομολόγιο.'; end if;
 if (p_route='BG' and v_date>=date '2026-11-30') or (p_route in ('B','G') and v_date<date '2026-11-30') then raise exception 'Το δρομολόγιο δεν είναι διαθέσιμο για τη σημερινή ημερομηνία. Κάνε ανανέωση.'; end if;$guard$);
 IF next_def=start_def THEN RAISE EXCEPTION 'Unexpected start function revision'; END IF;
 EXECUTE next_def;
 SELECT pg_get_functiondef('public.douleia_push_due(timestamptz)'::regprocedure) INTO push_def;
 next_def:=replace(push_def,'where c.dow between 1 and 5 and r.active and h.departures>=3',$guard$where c.dow between 1 and 5 and r.active and h.departures>=3
 and (r.code<>'COMBO2' or coalesce(t.departures,0)>0)
 and (r.code<>'BG' or c.day<date '2026-11-30' or coalesce(t.departures,0)>0)
 and (r.code not in ('B','G') or c.day>=date '2026-11-30' or coalesce(t.departures,0)>0)$guard$);
 IF next_def=push_def THEN RAISE EXCEPTION 'Unexpected push function revision'; END IF;
 EXECUTE next_def;
 INSERT INTO public.dromologia_routes(code,name,sort_order,active) VALUES
 ('COMBO2','2ο Combo',5,true),('B','Δρομολόγιο Β',6,true),('G','Δρομολόγιο Γ',7,true);
 UPDATE public.dromologia_routes SET sort_order=sort_order+100 WHERE code IN ('COMBO','COMBO2','A','D','BG','B','G','PM');
 UPDATE public.dromologia_routes SET sort_order=(CASE code WHEN 'COMBO' THEN 0 WHEN 'COMBO2' THEN 1 WHEN 'A' THEN 2 WHEN 'D' THEN 3 WHEN 'BG' THEN 4 WHEN 'B' THEN 5 WHEN 'G' THEN 6 WHEN 'PM' THEN 7 END)::smallint WHERE code IN ('COMBO','COMBO2','A','D','BG','B','G','PM');
END
$split$;

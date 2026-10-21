-- Stage 3: immutable v1 history + v2 evening template, atomic slot operations.
-- Apply once after stage 2. No business timestamps or historical minutes rewritten.
begin;
create function planner_private.slot_start(ver integer, slot integer) returns integer
language sql immutable set search_path = '' as $$
 select case ver when 1 then (array[480,540,600,660,780,840,900,960,1110,1215])[slot]
 when 2 then (array[480,540,600,660,780,840,900,960,1110,1200,1260])[slot] end
$$;
create function planner_private.slot_end(ver integer, slot integer) returns integer
language sql immutable set search_path = '' as $$
 select case ver when 1 then (array[540,600,660,720,840,900,960,1020,1215,1320])[slot]
 when 2 then (array[540,600,660,720,840,900,960,1020,1200,1260,1320])[slot] end
$$;
create function planner_private.valid_slots(ver integer, ids integer[], a integer, b integer) returns boolean
language plpgsql immutable set search_path = '' as $$
declare i integer; previous_end integer;
begin
 if ver not in (1,2) or cardinality(ids) not between 1 and 11 or array_lower(ids,1) <> 1 or array_position(ids,null) is not null then return false; end if;
 foreach i in array ids loop
   if planner_private.slot_start(ver,i) is null or (previous_end is not null and previous_end <> planner_private.slot_start(ver,i)) then return false; end if;
   previous_end := planner_private.slot_end(ver,i);
 end loop;
 return a = planner_private.slot_start(ver,ids[1]) and b = previous_end;
end $$;
alter table public.planner_schedules drop constraint planner_schedules_slot_template_version_check,
 drop constraint planner_schedules_slot_ids_check, drop constraint planner_schedules_check,
 drop constraint planner_schedules_occupied;
alter table public.planner_schedules add constraint planner_schedules_valid_slots
 check (planner_private.valid_slots(slot_template_version,slot_ids,start_minute,end_minute));
-- One row per occupied base slot. Array uniqueness alone does not prevent overlap.
create table public.planner_schedule_slots (
 owner_id uuid not null, date date not null, template_version integer not null, slot_id integer not null,
 schedule_id uuid not null,
 primary key(owner_id,date,template_version,slot_id),
 foreign key(owner_id,schedule_id) references public.planner_schedules(owner_id,id) on delete cascade
);
-- Common refinement of BOTH immutable templates: 8 daytime cells + 4 evening cells
-- [18:30,20:00), [20:00,20:15), [20:15,21:00), [21:00,22:00).
-- This unique key also prevents overlaps between different template versions.
create table public.planner_schedule_cells (
 owner_id uuid not null, date date not null, cell_id integer not null check(cell_id between 1 and 12),
 schedule_id uuid not null,
 primary key(owner_id,date,cell_id),
 foreign key(owner_id,schedule_id) references public.planner_schedules(owner_id,id) on delete cascade
);
alter table public.planner_schedule_slots enable row level security;
revoke all on public.planner_schedule_slots from public,anon,authenticated;
grant select on public.planner_schedule_slots to authenticated;
create policy own_read on public.planner_schedule_slots for select to authenticated using ((select auth.uid())=owner_id);
create policy own_insert on public.planner_schedule_slots for insert to authenticated with check ((select auth.uid())=owner_id);
create policy own_update on public.planner_schedule_slots for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy own_delete on public.planner_schedule_slots for delete to authenticated using ((select auth.uid())=owner_id);
alter table public.planner_schedule_cells enable row level security;
revoke all on public.planner_schedule_cells from public,anon,authenticated;
grant select on public.planner_schedule_cells to authenticated;
create policy own_read on public.planner_schedule_cells for select to authenticated using ((select auth.uid())=owner_id);
create policy own_insert on public.planner_schedule_cells for insert to authenticated with check ((select auth.uid())=owner_id);
create policy own_update on public.planner_schedule_cells for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy own_delete on public.planner_schedule_cells for delete to authenticated using ((select auth.uid())=owner_id);
create function planner_private.sync_schedule_occupancy() returns trigger
language plpgsql set search_path = '' as $$
begin
 delete from public.planner_schedule_slots where owner_id=new.owner_id and schedule_id=new.id;
 delete from public.planner_schedule_cells where owner_id=new.owner_id and schedule_id=new.id;
 insert into public.planner_schedule_slots select new.owner_id,new.date,new.slot_template_version,i,new.id from unnest(new.slot_ids) i;
 insert into public.planner_schedule_cells
 select new.owner_id,new.date,i,new.id from generate_series(1,12) i
 where (array[480,540,600,660,780,840,900,960,1110,1200,1215,1260])[i] >= new.start_minute
 and (array[540,600,660,720,840,900,960,1020,1200,1215,1260,1320])[i] <= new.end_minute;
 return new;
end $$;
create trigger schedule_occupancy after insert or update on public.planner_schedules
 for each row execute function planner_private.sync_schedule_occupancy();
-- Backfill derived occupancy without changing the historical business/audit data.
update public.planner_schedules set id=id;
create or replace function planner_private.validate_schedule(v jsonb) returns void
language plpgsql set search_path = '' as $$
declare ids integer[];
begin
  perform planner_private.shape(v,'{"id":"string","date":"string","slotTemplateVersion":"number","slotIds":"array","startMinute":"number","endMinute":"number","taskId":"*","title":"string","plannedRangeText":"string","note":"string"}');
  if v->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (v->'taskId' <> 'null'::jsonb and (jsonb_typeof(v->'taskId') <> 'string' or v->>'taskId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    or v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or v->>'slotTemplateVersion' not in ('1','2') or jsonb_array_length(v->'slotIds') not between 1 and 11
    or exists(select 1 from jsonb_array_elements(v->'slotIds') x where jsonb_typeof(x) <> 'number' or x::text !~ '^(1[01]|[1-9])$')
    or (length(btrim(v->>'title')) = 0 or length(v->>'title') > 200) or length(v->>'plannedRangeText') > 500 or length(v->>'note') > 5000 then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  if (v->>'date')::date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  select array_agg(x::text::integer order by ord) into ids from jsonb_array_elements(v->'slotIds') with ordinality as t(x,ord);
  if v->>'startMinute' !~ '^[0-9]+$' or v->>'endMinute' !~ '^[0-9]+$' or not planner_private.valid_slots((v->>'slotTemplateVersion')::integer,ids,(v->>'startMinute')::integer,(v->>'endMinute')::integer) then
    raise exception using errcode='P0001',message='INVALID_SLOT_SNAPSHOT';
  end if;
end $$;
create or replace function planner_private.put_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.validate_schedule(v);
  insert into public.planner_schedules(owner_id,id,date,slot_template_version,slot_ids,start_minute,end_minute,task_id,title,planned_range_text,note)
  values(u,(v->>'id')::uuid,(v->>'date')::date,(v->>'slotTemplateVersion')::integer,array(select x::text::integer from jsonb_array_elements(v->'slotIds') x),
    (v->>'startMinute')::integer,(v->>'endMinute')::integer,(v->>'taskId')::uuid,v->>'title',v->>'plannedRangeText',v->>'note')
  on conflict(owner_id,id) do update set date=excluded.date,slot_template_version=excluded.slot_template_version,slot_ids=excluded.slot_ids,
    start_minute=excluded.start_minute,end_minute=excluded.end_minute,task_id=excluded.task_id,title=excluded.title,
    planned_range_text=excluded.planned_range_text,note=excluded.note,updated_at=clock_timestamp();
end $$;
create function planner_private.merge_schedules(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare ids uuid[]; row public.planner_schedules; previous_end integer; first_start integer; day date; ver integer; total integer := 0; n integer := 0;
begin
 perform planner_private.shape(v,'{"ids":"array","result":"object","contentConfirmed":"boolean"}');
 if v->>'contentConfirmed' <> 'true' or jsonb_array_length(v->'ids') not between 2 and 11 then raise exception using errcode='P0001',message='CONTENT_CONFIRM_REQUIRED'; end if;
 select array_agg(x::text::uuid) into ids from jsonb_array_elements_text(v->'ids') x;
 if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception using errcode='P0001',message='DUPLICATE_ID'; end if;
 perform planner_private.validate_schedule(v->'result');
 if not ((v->'result'->>'id')::uuid = any(ids)) then raise exception using errcode='P0001',message='VALIDATION'; end if;
 for row in select * from public.planner_schedules where owner_id=u and id=any(ids) order by date,start_minute loop
   if n=0 then first_start:=row.start_minute; day:=row.date; ver:=row.slot_template_version;
   elsif row.date<>day or row.start_minute<>previous_end then raise exception using errcode='P0001',message='NOT_CONTIGUOUS'; end if;
   previous_end:=row.end_minute; total:=total+row.end_minute-row.start_minute; n:=n+1;
 end loop;
 if n<>cardinality(ids) then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
 if (v->'result'->>'date')::date<>day or (v->'result'->>'slotTemplateVersion')::integer<>ver
   or (v->'result'->>'startMinute')::integer<>first_start or (v->'result'->>'endMinute')::integer<>previous_end
   or previous_end-first_start<>total then raise exception using errcode='P0001',message='NOT_CONTIGUOUS'; end if;
 delete from public.planner_schedules where owner_id=u and id=any(ids);
 perform planner_private.put_schedule(u,v->'result');
end $$;
create function planner_private.split_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare row public.planner_schedules; i integer; first_slot boolean := true;
begin
 perform planner_private.shape(v,'{"id":"string","copyPlanText":"boolean"}');
 select * into row from public.planner_schedules where owner_id=u and id=(v->>'id')::uuid;
 if not found then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
 if cardinality(row.slot_ids)<2 then raise exception using errcode='P0001',message='VALIDATION'; end if;
 delete from public.planner_schedules where owner_id=u and id=row.id;
 foreach i in array row.slot_ids loop
   perform planner_private.put_schedule(u,jsonb_build_object('id',case when first_slot then row.id else gen_random_uuid() end,
    'date',to_char(row.date,'YYYY-MM-DD'),'slotTemplateVersion',row.slot_template_version,'slotIds',jsonb_build_array(i),
    'startMinute',planner_private.slot_start(row.slot_template_version,i),'endMinute',planner_private.slot_end(row.slot_template_version,i),
    'taskId',row.task_id,'title',row.title,
    'plannedRangeText',case when first_slot or (v->>'copyPlanText')::boolean then row.planned_range_text else '' end,
    'note',case when first_slot or (v->>'copyPlanText')::boolean then row.note else '' end));
   first_slot:=false;
 end loop;
end $$;
create or replace function public.planner_mutate(p_request_id uuid,p_expected_revision bigint,p_command jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); r bigint; h text; receipt public.planner_operation_receipts; v jsonb; item jsonb; result jsonb;
begin
  r := planner_private.lock_dataset(u);
  if p_request_id is null or p_expected_revision is null or p_expected_revision < 0 or p_command is null then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  -- SHA-256 on PostgreSQL canonical JSON; includes the fixed edit base.
  h := encode(sha256(convert_to(jsonb_build_object('revision',p_expected_revision,'command',p_command)::text,'UTF8')),'hex');
  select * into receipt from public.planner_operation_receipts where owner_id=u and request_id=p_request_id;
  if found then
    if receipt.command_hash <> h then raise exception using errcode='P0001',message='REQUEST_REUSED'; end if;
    return receipt.result;
  end if;
  if r <> p_expected_revision then raise exception using errcode='P0001',message='REVISION_CONFLICT'; end if;
  perform planner_private.shape(p_command,'{"type":"string","value":"object"}');
  v := p_command->'value';
  case p_command->>'type'
  when 'saveCategory' then perform planner_private.put_category(u,v);
  when 'saveTask' then perform planner_private.put_task(u,v);
  when 'mergeSchedules' then perform planner_private.merge_schedules(u,v);
  when 'splitSchedule' then perform planner_private.split_schedule(u,v);
  when 'saveSchedule' then perform planner_private.put_schedule(u,v);
  when 'removeSchedule' then
    perform planner_private.shape(v,'{"id":"string"}');
    delete from public.planner_schedules where owner_id=u and id=(v->>'id')::uuid;
    if not found then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
  when 'restore' then
    perform planner_private.shape(v,'{"categories":"array","tasks":"array","schedules":"array","settings":"object"}');
    perform planner_private.shape(v->'settings','{"timezone":"string","dateFormat":"string"}');
    if v->'settings'->>'timezone' <> 'Asia/Shanghai' or v->'settings'->>'dateFormat' <> 'YYYY-MM-DD' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    if (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'categories') x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'tasks') x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'schedules') x) then
      raise exception using errcode='P0001',message='DUPLICATE_ID';
    end if;
    -- Validate the entire input before replacement. Foreign keys also validate
    -- during inserts; any failure rolls back deletes, inserts and revision.
    for item in select * from jsonb_array_elements(v->'categories') loop
      perform planner_private.validate_audit(item);
      perform planner_private.validate_category(item - 'createdAt' - 'updatedAt');
    end loop;
    for item in select * from jsonb_array_elements(v->'tasks') loop
      perform planner_private.validate_audit(item);
      perform planner_private.validate_task(item - 'createdAt' - 'updatedAt');
    end loop;
    for item in select * from jsonb_array_elements(v->'schedules') loop
      perform planner_private.validate_audit(item);
      perform planner_private.validate_schedule(item - 'createdAt' - 'updatedAt');
    end loop;
    delete from public.planner_schedules where owner_id=u;
    delete from public.planner_tasks where owner_id=u;
    delete from public.planner_categories where owner_id=u;
    for item in select * from jsonb_array_elements(v->'categories') loop
      perform planner_private.put_category(u,item - 'createdAt' - 'updatedAt');
    end loop;
    for item in select * from jsonb_array_elements(v->'tasks') loop
      perform planner_private.put_task(u,item - 'createdAt' - 'updatedAt');
    end loop;
    for item in select * from jsonb_array_elements(v->'schedules') loop
      perform planner_private.put_schedule(u,item - 'createdAt' - 'updatedAt');
    end loop;
    update public.planner_settings set timezone=v->'settings'->>'timezone',date_format=v->'settings'->>'dateFormat',updated_at=clock_timestamp() where owner_id=u;
  else raise exception using errcode='P0001',message='VALIDATION';
  end case;
  r := r + 1;
  update public.planner_dataset_state set revision=r where owner_id=u;
  result := jsonb_build_object('requestId',p_request_id,'revision',r);
  insert into public.planner_operation_receipts(owner_id,request_id,command_hash,revision,result) values(u,p_request_id,h,r,result);
  return result;
end $$;
revoke all on all functions in schema planner_private from public,anon,authenticated;
revoke all on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) from public,anon;
grant execute on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) to authenticated;
-- Invalidate every pre-upgrade form, including older clients' task editors.
update public.planner_dataset_state set revision=revision+1;
notify pgrst, 'reload schema';
commit;

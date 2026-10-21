-- Stage 2: additive upgrade; apply AFTER 202610170001_stage1.sql.
-- Existing rows, revisions and idempotency receipts remain intact.
begin;
create table public.planner_schedules (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  date date not null check (date between date '0001-01-01' and date '9999-12-31'),
  slot_template_version integer not null check (slot_template_version = 1),
  slot_ids integer[] not null check (cardinality(slot_ids) = 1 and array_position(slot_ids,null) is null and array_lower(slot_ids,1) = 1 and slot_ids[1] between 1 and 10),
  start_minute integer not null, end_minute integer not null,
  task_id uuid, title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  planned_range_text text not null check (length(planned_range_text) <= 500),
  note text not null check (length(note) <= 5000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (owner_id,id),
  foreign key (owner_id,task_id) references public.planner_tasks(owner_id,id),
  constraint planner_schedules_occupied unique (owner_id,date,slot_ids),
  check (start_minute = (array[480,540,600,660,780,840,900,960,1110,1215])[slot_ids[1]]
     and end_minute = (array[540,600,660,720,840,900,960,1020,1215,1320])[slot_ids[1]])
);
alter table public.planner_schedules enable row level security;
revoke all on public.planner_schedules from public,anon,authenticated;
grant select on public.planner_schedules to authenticated;
create policy own_read on public.planner_schedules for select to authenticated using ((select auth.uid())=owner_id);
create policy own_insert on public.planner_schedules for insert to authenticated with check ((select auth.uid())=owner_id);
create policy own_update on public.planner_schedules for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy own_delete on public.planner_schedules for delete to authenticated using ((select auth.uid())=owner_id);

create function planner_private.validate_schedule(v jsonb) returns void
language plpgsql set search_path = '' as $$
declare slot integer;
begin
  perform planner_private.shape(v,'{"id":"string","date":"string","slotTemplateVersion":"number","slotIds":"array","startMinute":"number","endMinute":"number","taskId":"*","title":"string","plannedRangeText":"string","note":"string"}');
  if v->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (v->'taskId' <> 'null'::jsonb and (jsonb_typeof(v->'taskId') <> 'string' or v->>'taskId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    or v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or v->>'slotTemplateVersion' <> '1' or jsonb_array_length(v->'slotIds') <> 1
    or jsonb_typeof(v->'slotIds'->0) <> 'number' or v->'slotIds'->>0 !~ '^(10|[1-9])$'
    or (length(btrim(v->>'title')) = 0 or length(v->>'title') > 200) or length(v->>'plannedRangeText') > 500 or length(v->>'note') > 5000 then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  if (v->>'date')::date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  slot := (v->'slotIds'->>0)::integer;
  if v->>'startMinute' <> (array[480,540,600,660,780,840,900,960,1110,1215])[slot]::text
    or v->>'endMinute' <> (array[540,600,660,720,840,900,960,1020,1215,1320])[slot]::text then
    raise exception using errcode='P0001',message='INVALID_SLOT_SNAPSHOT';
  end if;
end $$;
create function planner_private.put_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.validate_schedule(v);
  insert into public.planner_schedules(owner_id,id,date,slot_template_version,slot_ids,start_minute,end_minute,task_id,title,planned_range_text,note)
  values(u,(v->>'id')::uuid,(v->>'date')::date,(v->>'slotTemplateVersion')::integer,array[(v->'slotIds'->>0)::integer],
    (v->>'startMinute')::integer,(v->>'endMinute')::integer,(v->>'taskId')::uuid,v->>'title',v->>'plannedRangeText',v->>'note')
  on conflict(owner_id,id) do update set date=excluded.date,slot_template_version=excluded.slot_template_version,slot_ids=excluded.slot_ids,
    start_minute=excluded.start_minute,end_minute=excluded.end_minute,task_id=excluded.task_id,title=excluded.title,
    planned_range_text=excluded.planned_range_text,note=excluded.note,updated_at=clock_timestamp();
end $$;
create or replace function public.planner_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); r bigint; result jsonb;
begin
  r := planner_private.lock_dataset(u);
  select jsonb_build_object('revision',r,'categories',
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'color',color,'archived',archived,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.planner_categories where owner_id=u),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'title',title,'unitName',unit_name,'totalUnits',total_units::text,'initialCompletedUnits',initial_completed_units::text,'initialProgressLabel',initial_progress_label,'note',note,'archived',archived,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.planner_tasks where owner_id=u),'[]'::jsonb),
    'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',to_char(date,'YYYY-MM-DD'),'slotTemplateVersion',slot_template_version,'slotIds',slot_ids,
      'startMinute',start_minute,'endMinute',end_minute,'taskId',task_id,'title',title,'plannedRangeText',planned_range_text,'note',note,'createdAt',created_at,'updatedAt',updated_at) order by date,start_minute,id) from public.planner_schedules where owner_id=u),'[]'::jsonb),
    'settings',(select jsonb_build_object('timezone',timezone,'dateFormat',date_format) from public.planner_settings where owner_id=u)) into result;
  return result;
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

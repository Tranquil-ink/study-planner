-- Stage 5A: persistent todos, weekly commitments and capacity snapshots.
begin;
create table public.planner_todos (
 owner_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 title text not null check(length(btrim(title)) between 1 and 200), estimated_minutes integer check(estimated_minutes > 0),
 note text not null check(length(note) <= 5000), archived boolean not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), primary key(owner_id,id)
);
create table public.planner_week_plans (
 owner_id uuid not null references auth.users(id) on delete cascade,
 week_start date not null check(extract(isodow from week_start)=1), document jsonb not null, primary key(owner_id,week_start)
);
create table public.planner_availability_templates (
 owner_id uuid primary key references auth.users(id) on delete cascade, availability jsonb not null
);
do $$ declare tab text; begin
 foreach tab in array array['planner_todos','planner_week_plans','planner_availability_templates'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from public,anon,authenticated',tab);
 execute format('grant select on public.%I to authenticated',tab);
 execute format('create policy own_read on public.%I for select to authenticated using ((select auth.uid())=owner_id)',tab);
 execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid())=owner_id)',tab);
 execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',tab);
 execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid())=owner_id)',tab);
 end loop;
end $$;
create function planner_private.valid_id(v jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(v)='string' and v #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
create function planner_private.valid_date(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 return jsonb_typeof(v)='string' and v #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (v #>> '{}')::date between date '0001-01-01' and date '9999-12-31';
end $$;
create function planner_private.validate_availability(v jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb; begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>1000 then raise exception 'VALIDATION'; end if;
 for x in select * from jsonb_array_elements(v) loop
 perform planner_private.shape(x,'{"day":"number","startMinute":"number","endMinute":"number"}');
 if x->>'day' !~ '^[0-6]$' or x->>'startMinute' !~ '^(0|[1-9][0-9]*)$' or x->>'endMinute' !~ '^[1-9][0-9]*$'
 or (x->>'startMinute')::numeric >= (x->>'endMinute')::numeric or (x->>'endMinute')::numeric > 1440 then raise exception 'VALIDATION'; end if;
 end loop;
end $$;
create function planner_private.put_todo(u uuid,v jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform planner_private.shape(v,'{"id":"string","title":"string","estimatedMinutes":"*","note":"string","archived":"boolean"}');
 if not planner_private.valid_id(v->'id') or length(btrim(v->>'title')) not between 1 and 200 or length(v->>'note')>5000
 or (v->'estimatedMinutes'<>'null'::jsonb and (jsonb_typeof(v->'estimatedMinutes')<>'number' or v->>'estimatedMinutes' !~ '^[1-9][0-9]*$' or (v->>'estimatedMinutes')::numeric>2147483647)) then raise exception 'VALIDATION'; end if;
 insert into public.planner_todos(owner_id,id,title,estimated_minutes,note,archived)
 values(u,(v->>'id')::uuid,v->>'title',(v->>'estimatedMinutes')::integer,v->>'note',(v->>'archived')::boolean)
 on conflict(owner_id,id) do update set title=excluded.title,estimated_minutes=excluded.estimated_minutes,note=excluded.note,archived=excluded.archived,updated_at=clock_timestamp();
end $$;
create function planner_private.validate_entries(u uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb; begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>1000 then raise exception 'VALIDATION'; end if;
 if (select count(*)<>count(distinct j.value->>'id') or count(*)<>count(distinct coalesce(j.value->>'taskId',j.value->>'todoId')) from jsonb_array_elements(v) j(value)) then raise exception 'DUPLICATE_ID'; end if;
 for x in select * from jsonb_array_elements(v) loop
 perform planner_private.shape(x,'{"id":"string","taskId":"*","todoId":"*","titleSnapshot":"string","goalType":"string","estimatedMinutes":"number","targetUnits":"*","unitName":"string","importance":"string","deadline":"*","carryToNextWeek":"boolean","cancelled":"boolean"}');
 if not planner_private.valid_id(x->'id') or (x->'taskId'='null'::jsonb)=(x->'todoId'='null'::jsonb)
 or x->>'goalType' not in ('progress','time','todo') or (x->'todoId'<>'null'::jsonb)<>(x->>'goalType'='todo')
 or length(btrim(x->>'titleSnapshot')) not between 1 and 200 or length(x->>'unitName')>20
 or x->>'estimatedMinutes' !~ '^[1-9][0-9]*$' or (x->>'estimatedMinutes')::numeric>2147483647
 or x->>'importance' not in ('normal','important','critical') then raise exception 'VALIDATION'; end if;
 if x->'deadline'<>'null'::jsonb and not planner_private.valid_date(x->'deadline') then raise exception 'VALIDATION'; end if;
 if x->'taskId'<>'null'::jsonb then
   if not planner_private.valid_id(x->'taskId') or not exists(select 1 from public.planner_tasks where owner_id=u and id=(x->>'taskId')::uuid and unit_name=x->>'unitName') then raise exception 'PLAN_REFERENCE'; end if;
 else
   if not planner_private.valid_id(x->'todoId') or x->>'unitName'<>'' or x->'targetUnits'<>'null'::jsonb
   or not exists(select 1 from public.planner_todos where owner_id=u and id=(x->>'todoId')::uuid) then raise exception 'PLAN_REFERENCE'; end if;
 end if;
 if x->'targetUnits'<>'null'::jsonb then perform planner_private.quantity(x->'targetUnits'); end if;
 if x->>'goalType'='progress' and (x->'targetUnits'='null'::jsonb or (x->>'targetUnits')::numeric<=0) then raise exception 'VALIDATION'; end if;
 end loop;
end $$;
create function planner_private.validate_entry_continuity(prior jsonb,current_entries jsonb) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(prior) p where not exists(select 1 from jsonb_array_elements(current_entries) n
 where n->>'id'=p->>'id' and n->'taskId'=p->'taskId' and n->'todoId'=p->'todoId')) then raise exception 'PLAN_IDENTITY'; end if;
end $$;
create function planner_private.validate_week(u uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare h jsonb; previous_entries jsonb:='[]'; previous_time timestamptz; begin
 perform planner_private.shape(v,'{"weekStart":"string","availability":"array","entries":"array","confirmedAt":"*","initialEntries":"*","history":"array","createdAt":"string","updatedAt":"string"}');
 perform planner_private.validate_audit(v);
 if not planner_private.valid_date(v->'weekStart') or extract(isodow from (v->>'weekStart')::date)<>1
 or (v->'confirmedAt'='null'::jsonb)<>(v->'initialEntries'='null'::jsonb) or jsonb_array_length(v->'history')=0 then raise exception 'VALIDATION'; end if;
 perform planner_private.validate_availability(v->'availability'); perform planner_private.validate_entries(u,v->'entries');
 if v->'confirmedAt'<>'null'::jsonb then
   if jsonb_typeof(v->'confirmedAt')<>'string' or not exists(select 1 from jsonb_array_elements(v->'history') x where x->'at'=v->'confirmedAt' and x->'entries'=v->'initialEntries') then raise exception 'PLAN_HISTORY'; end if;
   perform planner_private.validate_entries(u,v->'initialEntries');
 end if;
 previous_time:=(v->>'createdAt')::timestamptz;
 for h in select * from jsonb_array_elements(v->'history') loop
   perform planner_private.shape(h,'{"at":"string","entries":"array","availability":"array"}');
   perform planner_private.validate_audit(jsonb_build_object('createdAt',h->'at','updatedAt',h->'at'));
   if (h->>'at')::timestamptz < previous_time or (h->>'at')::timestamptz > (v->>'updatedAt')::timestamptz then raise exception 'PLAN_HISTORY'; end if;
   previous_time:=(h->>'at')::timestamptz;
   perform planner_private.validate_entries(u,h->'entries'); perform planner_private.validate_availability(h->'availability');
   perform planner_private.validate_entry_continuity(previous_entries,h->'entries'); previous_entries:=h->'entries';
 end loop;
 if v->'history'->-1->'entries'<>v->'entries' or v->'history'->-1->'availability'<>v->'availability' then raise exception 'PLAN_HISTORY'; end if;
end $$;
create function planner_private.put_week(u uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare old_doc jsonb; doc jsonb; stamp jsonb:=to_jsonb(clock_timestamp()); begin
 perform planner_private.shape(v,'{"weekStart":"string","availability":"array","entries":"array","confirm":"boolean"}');
 if not planner_private.valid_date(v->'weekStart') then raise exception 'VALIDATION'; end if;
 select document into old_doc from public.planner_week_plans where owner_id=u and week_start=(v->>'weekStart')::date;
 if old_doc is not null then perform planner_private.validate_entry_continuity(old_doc->'entries',v->'entries'); end if;
 if (v->>'confirm')::boolean and old_doc->'confirmedAt'<>'null'::jsonb then raise exception 'PLAN_ALREADY_CONFIRMED'; end if;
 doc:=jsonb_build_object('weekStart',v->'weekStart','entries',v->'entries','availability',v->'availability',
 'createdAt',coalesce(old_doc->'createdAt',stamp),'updatedAt',stamp,
 'confirmedAt',case when (v->>'confirm')::boolean then stamp else coalesce(old_doc->'confirmedAt','null'::jsonb) end,
 'initialEntries',case when (v->>'confirm')::boolean then v->'entries' else coalesce(old_doc->'initialEntries','null'::jsonb) end,
 'history',coalesce(old_doc->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',stamp,'entries',v->'entries','availability',v->'availability')));
 perform planner_private.validate_week(u,doc);
 insert into public.planner_week_plans values(u,(v->>'weekStart')::date,doc) on conflict(owner_id,week_start) do update set document=excluded.document;
end $$;
-- Snapshot extends the established consistent, account-locked stage-4 reader.
alter function public.planner_snapshot() rename to snapshot_v4;
alter function public.snapshot_v4() set schema planner_private;
create function public.planner_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; u uuid:=auth.uid(); begin
 base:=planner_private.snapshot_v4();
 return base || jsonb_build_object(
 'todos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'estimatedMinutes',estimated_minutes,'note',note,'archived',archived,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.planner_todos where owner_id=u),'[]'::jsonb),
 'weekPlans',coalesce((select jsonb_agg(document order by week_start) from public.planner_week_plans where owner_id=u),'[]'::jsonb),
 'availabilityTemplate',coalesce((select availability from public.planner_availability_templates where owner_id=u),'[]'::jsonb));
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
  when 'saveTodo' then perform planner_private.put_todo(u,v);
  when 'saveWeekPlan' then perform planner_private.put_week(u,v);
  when 'saveAvailabilityTemplate' then
    perform planner_private.shape(v,'{"availability":"array"}');
    perform planner_private.validate_availability(v->'availability');
    insert into public.planner_availability_templates values(u,v->'availability') on conflict(owner_id) do update set availability=excluded.availability;
  when 'saveCategory' then perform planner_private.put_category(u,v);
  when 'saveTask' then perform planner_private.put_task(u,v);
  when 'saveWorkLog' then perform planner_private.put_work_log(u,v);
  when 'removeWorkLog' then
    perform planner_private.shape(v,'{"id":"string"}');
    delete from public.planner_work_logs where owner_id=u and id=(v->>'id')::uuid;
    if not found then raise exception using errcode='P0001',message='WORK_LOG_MISSING'; end if;
  when 'mergeSchedules' then
    if exists(select 1 from public.planner_work_logs where owner_id=u and schedule_block_id in (select x::uuid from jsonb_array_elements_text(v->'ids') x)) then
      raise exception using errcode='P0001',message='SCHEDULE_HAS_LOGS';
    end if;
    perform planner_private.merge_schedules(u,v);
  when 'splitSchedule' then
    if exists(select 1 from public.planner_work_logs where owner_id=u and schedule_block_id=(v->>'id')::uuid) then
      raise exception using errcode='P0001',message='SCHEDULE_HAS_LOGS';
    end if;
    perform planner_private.split_schedule(u,v);
  when 'saveSchedule' then perform planner_private.put_schedule(u,v);
  when 'removeSchedule' then
    perform planner_private.shape(v,'{"id":"string"}');
    delete from public.planner_schedules where owner_id=u and id=(v->>'id')::uuid;
    if not found then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
  when 'restore' then
    perform planner_private.shape(v,'{"categories":"array","tasks":"array","schedules":"array","workLogs":"array","settings":"object","todos":"array","weekPlans":"array","availabilityTemplate":"array"}');
    perform planner_private.shape(v->'settings','{"timezone":"string","dateFormat":"string"}');
    if v->'settings'->>'timezone' <> 'Asia/Shanghai' or v->'settings'->>'dateFormat' <> 'YYYY-MM-DD' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    if (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'categories') x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'tasks') x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'schedules') x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'workLogs') x)
      or (select count(*) <> count(distinct (x->>'createdOrder')::bigint) from jsonb_array_elements(v->'workLogs') x) then
      raise exception using errcode='P0001',message='DUPLICATE_ID';
    end if;
    if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(v->'todos') x)
    or (select count(*)<>count(distinct x->>'weekStart') from jsonb_array_elements(v->'weekPlans') x) then raise exception 'DUPLICATE_ID'; end if;
    perform planner_private.validate_availability(v->'availabilityTemplate');
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
    for item in select * from jsonb_array_elements(v->'workLogs') loop
      perform planner_private.validate_audit(item);
      if jsonb_typeof(item->'createdOrder') is distinct from 'number' or item->>'createdOrder' !~ '^[1-9][0-9]*$'
        or (item->>'createdOrder')::numeric > 9007199254740990 then raise exception using errcode='P0001',message='VALIDATION'; end if;
      perform planner_private.validate_work_log(item - 'createdAt' - 'updatedAt' - 'createdOrder');
    end loop;
    delete from public.planner_week_plans where owner_id=u;
    delete from public.planner_todos where owner_id=u;
    delete from public.planner_availability_templates where owner_id=u;
    delete from public.planner_work_logs where owner_id=u;
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
    for item in select * from jsonb_array_elements(v->'workLogs') loop
      perform planner_private.put_work_log(u,item - 'createdAt' - 'updatedAt' - 'createdOrder',(item->>'createdOrder')::bigint);
    end loop;
    for item in select * from jsonb_array_elements(v->'todos') loop
      perform planner_private.validate_audit(item);
      perform planner_private.put_todo(u,item - 'createdAt' - 'updatedAt');
    end loop;
    for item in select * from jsonb_array_elements(v->'weekPlans') loop
      perform planner_private.validate_week(u,item);
      insert into public.planner_week_plans values(u,(item->>'weekStart')::date,item);
    end loop;
    insert into public.planner_availability_templates values(u,v->'availabilityTemplate');
    update public.planner_settings set timezone=v->'settings'->>'timezone',date_format=v->'settings'->>'dateFormat',updated_at=clock_timestamp() where owner_id=u;
  else raise exception using errcode='P0001',message='VALIDATION';
  end case;
  -- References inside historical JSON are owner-scoped and unit-stable too.
  for item in select document from public.planner_week_plans where owner_id=u loop
    perform planner_private.validate_week(u,item);
  end loop;
  perform planner_private.check_progress(u);
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

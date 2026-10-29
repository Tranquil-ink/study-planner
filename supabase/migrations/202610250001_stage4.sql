-- Stage 4: actual learning records; apply once after stage 3.
-- All writes retain the per-account lock, revision and idempotency receipt.
begin;
alter table public.planner_dataset_state add column work_log_order bigint not null default 0
 check(work_log_order between 0 and 9007199254740990);
create table public.planner_work_logs (
 owner_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 date date not null check(date between date '0001-01-01' and date '9999-12-31'),
 task_id uuid, schedule_block_id uuid,
 title_snapshot text not null check(length(btrim(title_snapshot)) between 1 and 200),
 actual_minutes integer not null check(actual_minutes > 0),
 progress_delta numeric check(progress_delta >= 0 and progress_delta <= 999999999.999999 and scale(progress_delta) <= 6),
 progress_label text not null check(length(progress_label) <= 200), note text not null check(length(note) <= 5000),
 created_order bigint not null check(created_order between 1 and 9007199254740990),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,id), unique(owner_id,created_order),
 foreign key(owner_id,task_id) references public.planner_tasks(owner_id,id),
 foreign key(owner_id,schedule_block_id) references public.planner_schedules(owner_id,id),
 check((task_id is null) = (progress_delta is null))
);
alter table public.planner_work_logs enable row level security;
revoke all on public.planner_work_logs from public,anon,authenticated;
grant select on public.planner_work_logs to authenticated;
create policy own_read on public.planner_work_logs for select to authenticated using ((select auth.uid())=owner_id);
create policy own_insert on public.planner_work_logs for insert to authenticated with check ((select auth.uid())=owner_id);
create policy own_update on public.planner_work_logs for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy own_delete on public.planner_work_logs for delete to authenticated using ((select auth.uid())=owner_id);

-- Delete or change the planned task without rewriting learning facts or their order.
create function planner_private.detach_work_logs() returns trigger
language plpgsql set search_path = '' as $$
begin
 if TG_OP='DELETE' then
   update public.planner_work_logs set schedule_block_id=null,updated_at=clock_timestamp() where owner_id=old.owner_id and schedule_block_id=old.id;
   return old;
 elsif new.task_id is distinct from old.task_id then
   update public.planner_work_logs set schedule_block_id=null,updated_at=clock_timestamp() where owner_id=old.owner_id and schedule_block_id=old.id;
 end if;
 return new;
end $$;
create trigger detach_work_logs before delete or update on public.planner_schedules
 for each row execute function planner_private.detach_work_logs();

create function planner_private.validate_work_log(v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
 perform planner_private.shape(v,'{"id":"string","date":"string","taskId":"*","scheduleBlockId":"*","titleSnapshot":"string","actualMinutes":"number","progressDelta":"*","progressLabel":"string","note":"string"}');
 if v->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or (v->'taskId' <> 'null'::jsonb and (jsonb_typeof(v->'taskId') <> 'string' or v->>'taskId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
 or (v->'scheduleBlockId' <> 'null'::jsonb and (jsonb_typeof(v->'scheduleBlockId') <> 'string' or v->>'scheduleBlockId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
 or v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (v->>'date')::date not between date '0001-01-01' and date '9999-12-31'
 or v->>'actualMinutes' !~ '^[1-9][0-9]*$' or (v->>'actualMinutes')::numeric > 2147483647
 or length(btrim(v->>'titleSnapshot')) not between 1 and 200 or length(v->>'progressLabel') > 200 or length(v->>'note') > 5000
 or ((v->'taskId' = 'null'::jsonb) <> (v->'progressDelta' = 'null'::jsonb)) then
   raise exception using errcode='P0001',message='VALIDATION';
 end if;
 if v->'progressDelta' <> 'null'::jsonb then perform planner_private.quantity(v->'progressDelta'); end if;
end $$;
create function planner_private.put_work_log(u uuid,v jsonb,restore_order bigint default null) returns void
language plpgsql set search_path = '' as $$
declare n bigint;
begin
 perform planner_private.validate_work_log(v);
 if v->'scheduleBlockId' <> 'null'::jsonb and not exists(select 1 from public.planner_schedules
   where owner_id=u and id=(v->>'scheduleBlockId')::uuid and task_id is not distinct from (v->>'taskId')::uuid) then
   raise exception using errcode='P0001',message='LOG_SCHEDULE_MISMATCH';
 end if;
 select created_order into n from public.planner_work_logs where owner_id=u and id=(v->>'id')::uuid;
 if not found then
   if restore_order is null then
     update public.planner_dataset_state set work_log_order=work_log_order+1 where owner_id=u returning work_log_order into n;
   else
     n:=restore_order;
     update public.planner_dataset_state set work_log_order=greatest(work_log_order,n) where owner_id=u;
   end if;
 end if;
 insert into public.planner_work_logs(owner_id,id,date,task_id,schedule_block_id,title_snapshot,actual_minutes,progress_delta,progress_label,note,created_order)
 values(u,(v->>'id')::uuid,(v->>'date')::date,(v->>'taskId')::uuid,(v->>'scheduleBlockId')::uuid,v->>'titleSnapshot',
  (v->>'actualMinutes')::integer,(v->>'progressDelta')::numeric,v->>'progressLabel',v->>'note',n)
 on conflict(owner_id,id) do update set date=excluded.date,task_id=excluded.task_id,schedule_block_id=excluded.schedule_block_id,
  title_snapshot=excluded.title_snapshot,actual_minutes=excluded.actual_minutes,progress_delta=excluded.progress_delta,
  progress_label=excluded.progress_label,note=excluded.note,updated_at=clock_timestamp();
end $$;
-- Called while holding DatasetState FOR UPDATE, including after task edits/restores.
create function planner_private.check_progress(u uuid) returns void
language plpgsql set search_path = '' as $$
begin
 if exists(select 1 from public.planner_tasks t where t.owner_id=u and t.total_units is not null
   and t.initial_completed_units + coalesce((select sum(l.progress_delta) from public.planner_work_logs l where l.owner_id=u and l.task_id=t.id),0) > t.total_units) then
   raise exception using errcode='P0001',message='PROGRESS_LIMIT';
 end if;
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
    'workLogs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',to_char(date,'YYYY-MM-DD'),'taskId',task_id,'scheduleBlockId',schedule_block_id,'titleSnapshot',title_snapshot,'actualMinutes',actual_minutes,'progressDelta',progress_delta::text,'progressLabel',progress_label,'note',note,'createdOrder',created_order,'createdAt',created_at,'updatedAt',updated_at) order by date,created_order) from public.planner_work_logs where owner_id=u),'[]'::jsonb),
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
    perform planner_private.shape(v,'{"categories":"array","tasks":"array","schedules":"array","workLogs":"array","settings":"object"}');
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
    update public.planner_settings set timezone=v->'settings'->>'timezone',date_format=v->'settings'->>'dateFormat',updated_at=clock_timestamp() where owner_id=u;
  else raise exception using errcode='P0001',message='VALIDATION';
  end case;
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

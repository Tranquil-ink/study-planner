-- Preserve the stage 5 dataset while adding a three-period schedule board.
begin;

alter table public.planner_tasks add column activated boolean not null default false;
alter table public.planner_todos add column activated boolean not null default false;

create or replace function planner_private.valid_capacity(v integer[]) returns boolean
language sql immutable set search_path = '' as $$
  select array_ndims(v)=2 and array_lower(v,1)=1 and array_length(v,1)=7 and array_lower(v,2)=1 and array_length(v,2)=3
    and not exists(select 1 from unnest(v) n where n is null or n not between 0 and 1440)
    and not exists(select 1 from generate_series(1,7) d where v[d][1]::bigint + v[d][2] + v[d][3] > 1440)
$$;

update public.planner_settings s
set capacity_template=(select array_agg(array[n,0,0] order by i) from unnest(s.capacity_template) with ordinality as x(n,i))
where s.capacity_template is not null;
update public.planner_weeks w
set capacity=(select array_agg(array[n,0,0] order by i) from unnest(w.capacity) with ordinality as x(n,i))
where w.capacity is not null;

create or replace function planner_private.capacity_arg(v jsonb) returns integer[]
language plpgsql immutable set search_path = '' as $$
declare result integer[]; values_for_day jsonb; minutes integer[];
begin
  if v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)<>7 then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  for values_for_day in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(values_for_day) is distinct from 'array' or jsonb_array_length(values_for_day)<>3 then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    select array_agg(planner_private.minutes_arg(x,0,1440) order by ord) into minutes
      from jsonb_array_elements(values_for_day) with ordinality as t(x,ord);
    result:=array_cat(result,array[minutes]);
  end loop;
  if planner_private.valid_capacity(result) is not true then
    raise exception using errcode='P0001',message='CAPACITY_LIMIT';
  end if;
  return result;
end $$;

alter table public.planner_schedules
  add column period text not null default 'morning' check (period in ('morning','afternoon','evening')),
  add column position integer not null default 0 check (position>=0),
  add column outcome text not null default 'pending' check (outcome in ('pending','completed','skipped'));

with ordered as (
  select s.owner_id,s.id,(row_number() over(partition by s.owner_id,s.date order by s.created_at,s.id)-1)::integer as pos,
    case when not s.resolved then 'pending' when exists(
      select 1 from public.planner_work_logs l where l.owner_id=s.owner_id and l.schedule_block_id=s.id
    ) then 'completed' else 'skipped' end as outcome
  from public.planner_schedules s
)
update public.planner_schedules s set position=o.pos,outcome=o.outcome from ordered o where (s.owner_id,s.id)=(o.owner_id,o.id);

alter table public.planner_schedules drop column resolved,
  add constraint planner_schedule_period_position unique (owner_id,date,period,position) deferrable initially deferred;

create function planner_private.period_arg(v jsonb) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' not in ('morning','afternoon','evening') then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  return v#>>'{}';
end $$;

create function planner_private.append_position(u uuid,d date,p text) returns integer
language plpgsql set search_path = '' as $$
declare last_position integer;
begin
  select max(position) into last_position from public.planner_schedules where owner_id=u and date=d and period=p;
  -- A restored backup may contain gaps, even at the maximum integer position.
  if last_position=2147483647 then
    with ranked as (select id,(row_number() over(order by position)-1)::integer as pos
      from public.planner_schedules where owner_id=u and date=d and period=p)
    update public.planner_schedules s set position=r.pos from ranked r where s.owner_id=u and s.id=r.id;
    select max(position) into last_position from public.planner_schedules where owner_id=u and date=d and period=p;
  end if;
  return coalesce(last_position,-1)+1;
end $$;

create or replace function planner_private.put_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare row_id uuid; d date; p text; pos integer;
begin
  perform planner_private.shape(v,'{"id":"string","date":"string","period":"string","taskId":"*","todoId":"*","title":"string","plannedMinutes":"number","plannedUnits":"*","plannedRangeText":"string","note":"string"}');
  row_id:=planner_private.uuid_arg(v->'id');
  d:=planner_private.date_arg(v->'date');
  p:=planner_private.period_arg(v->'period');
  select position into pos from public.planner_schedules where owner_id=u and id=row_id and date=d and period=p;
  if not found then pos:=planner_private.append_position(u,d,p); end if;
  insert into public.planner_schedules(owner_id,id,date,period,position,task_id,todo_id,title,planned_minutes,planned_units,planned_range_text,note)
  values(u,row_id,d,p,pos,planner_private.uuid_arg(v->'taskId'),planner_private.uuid_arg(v->'todoId'),v->>'title',
    planner_private.minutes_arg(v->'plannedMinutes',1,1440),planner_private.optional_quantity(v->'plannedUnits'),v->>'plannedRangeText',v->>'note')
  on conflict(owner_id,id) do update set date=excluded.date,period=excluded.period,position=excluded.position,task_id=excluded.task_id,
    todo_id=excluded.todo_id,title=excluded.title,planned_minutes=excluded.planned_minutes,
    planned_units=excluded.planned_units,planned_range_text=excluded.planned_range_text,note=excluded.note,
    outcome=case when planner_schedules.task_id is distinct from excluded.task_id or planner_schedules.todo_id is distinct from excluded.todo_id
      then 'pending' else planner_schedules.outcome end,updated_at=clock_timestamp();
end $$;

create function planner_private.move_schedule(u uuid,v jsonb) returns date
language plpgsql set search_path = '' as $$
declare row_id uuid; anchor uuid; anchor_position integer; d date; p text;
begin
  perform planner_private.shape(v,'{"id":"string","date":"string","period":"string","beforeId":"*"}');
  row_id:=planner_private.uuid_arg(v->'id');
  anchor:=planner_private.uuid_arg(v->'beforeId');
  d:=planner_private.date_arg(v->'date');
  p:=planner_private.period_arg(v->'period');
  if not exists(select 1 from public.planner_schedules where owner_id=u and id=row_id) then
    raise exception using errcode='P0001',message='SCHEDULE_MISSING';
  end if;
  if anchor is not null then
    select position into anchor_position from public.planner_schedules where owner_id=u and id=anchor and date=d and period=p and id<>row_id;
    if not found then raise exception using errcode='P0001',message='SCHEDULE_POSITION_CHANGED'; end if;
  end if;
  with ordered as (
    select id,(row_number() over(order by
      case when id=row_id then coalesce(anchor_position::bigint,2147483648) else position end,
      (id=row_id) desc)-1)::integer as pos
    from public.planner_schedules where owner_id=u and (id=row_id or (date=d and period=p))
  )
  update public.planner_schedules s set date=d,period=p,position=o.pos,
    updated_at=case when s.id=row_id or s.position<>o.pos then clock_timestamp() else s.updated_at end
    from ordered o where s.owner_id=u and s.id=o.id;
  return d;
end $$;

create function planner_private.create_scheduled_entry(u uuid,v jsonb) returns date
language plpgsql set search_path = '' as $$
declare entry jsonb:=v->'entry'; card jsonb:=v->'schedule'; entry_id uuid;
begin
  perform planner_private.shape(v,'{"entry":"object","schedule":"object"}');
  perform planner_private.shape(entry,'{"type":"string","value":"object"}');
  entry_id:=planner_private.uuid_arg(entry->'value'->'id');
  if exists(select 1 from public.planner_schedules where owner_id=u and id=planner_private.uuid_arg(card->'id')) then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  case entry->>'type'
  when 'saveTask' then
    if entry_id is distinct from planner_private.uuid_arg(card->'taskId')
      or exists(select 1 from public.planner_tasks where owner_id=u and id=entry_id) then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_task(u,entry->'value');
  when 'saveTodo' then
    if entry_id is distinct from planner_private.uuid_arg(card->'todoId')
      or exists(select 1 from public.planner_todos where owner_id=u and id=entry_id) then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_todo(u,entry->'value');
  else raise exception using errcode='P0001',message='VALIDATION';
  end case;
  perform planner_private.put_schedule(u,card);
  return planner_private.date_arg(card->'date');
end $$;

create function planner_private.complete_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare card public.planner_schedules; previous public.planner_work_logs;
  log_id uuid; happened date; minutes integer; reached numeric; starting numeric; delta numeric;
begin
  perform planner_private.shape(v,'{"id":"string","logId":"string","date":"string","actualMinutes":"number","reachedUnits":"*","progressLabel":"string","note":"string"}');
  select * into card from public.planner_schedules where owner_id=u and id=planner_private.uuid_arg(v->'id');
  if not found then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
  if card.outcome<>'pending' then raise exception using errcode='P0001',message='SCHEDULE_OUTCOME_CHANGED'; end if;
  happened:=planner_private.date_arg(v->'date');
  if happened>(statement_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  log_id:=planner_private.uuid_arg(v->'logId');
  minutes:=planner_private.minutes_arg(v->'actualMinutes',1,2147483647);
  reached:=planner_private.optional_quantity(v->'reachedUnits');
  select * into previous from public.planner_work_logs where owner_id=u and id=log_id;
  if found and previous.schedule_block_id is distinct from card.id then
    raise exception using errcode='P0001',message='LOG_SCHEDULE_MISMATCH';
  end if;
  if card.task_id is null then
    if reached is not null or v->>'progressLabel'<>'' then raise exception using errcode='P0001',message='VALIDATION'; end if;
  elsif reached is null then
    delta:=coalesce(previous.progress_delta,0);
  else
    select t.initial_completed_units + coalesce((select sum(l.progress_delta) from public.planner_work_logs l
      where l.owner_id=u and l.task_id=card.task_id and l.date<=happened and l.id<>log_id),0)
    into starting from public.planner_tasks t where t.owner_id=u and t.id=card.task_id;
    if reached<starting then raise exception using errcode='P0001',message='PROGRESS_BEHIND'; end if;
    delta:=reached-starting;
  end if;
  perform planner_private.put_work_log(u,jsonb_build_object('id',log_id,'date',to_char(happened,'YYYY-MM-DD'),
    'taskId',card.task_id,'todoId',card.todo_id,'scheduleBlockId',card.id,'titleSnapshot',card.title,
    'actualMinutes',minutes,'progressDelta',delta::text,'progressLabel',v->>'progressLabel','note',v->>'note'));
  update public.planner_schedules set outcome='completed',updated_at=clock_timestamp() where owner_id=u and id=card.id;
  if card.todo_id is not null then
    update public.planner_todos set completed_on=least(completed_on,happened),updated_at=clock_timestamp()
      where owner_id=u and id=card.todo_id;
  end if;
end $$;

create function planner_private.set_schedule_outcome(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare row_id uuid; next_outcome text;
begin
  perform planner_private.shape(v,'{"id":"string","outcome":"string"}');
  row_id:=planner_private.uuid_arg(v->'id');
  next_outcome:=v->>'outcome';
  if next_outcome not in ('pending','skipped') then raise exception using errcode='P0001',message='VALIDATION'; end if;
  if next_outcome='skipped' and exists(select 1 from public.planner_work_logs where owner_id=u and schedule_block_id=row_id) then
    raise exception using errcode='P0001',message='SCHEDULE_HAS_ACTUAL';
  end if;
  update public.planner_schedules set outcome=next_outcome,updated_at=clock_timestamp()
    where owner_id=u and id=row_id and ((outcome='pending' and next_outcome='skipped') or (outcome='skipped' and next_outcome='pending'));
  if not found then raise exception using errcode='P0001',message='SCHEDULE_OUTCOME_CHANGED'; end if;
end $$;

create or replace function planner_private.restore_week_planner(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; k text; b jsonb; w date; committed text;
begin
  perform planner_private.shape(v,'{"categories":"array","projects":"array","tasks":"array","todos":"array","weeks":"array","weekItems":"array","schedules":"array","workLogs":"array","settings":"object"}');
  perform planner_private.shape(v->'settings','{"timezone":"string","dateFormat":"string","capacityTemplate":"*"}');
  if v->'settings'->>'timezone'<>'Asia/Shanghai' or v->'settings'->>'dateFormat'<>'YYYY-MM-DD' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  foreach k in array array['categories','projects','tasks','todos','weekItems','schedules','workLogs'] loop
    if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(v->k) x) then
      raise exception using errcode='P0001',message='DUPLICATE_ID';
    end if;
    for item in select * from jsonb_array_elements(v->k) loop
      perform planner_private.validate_audit(item);
    end loop;
  end loop;
  if (select count(*)<>count(distinct x->>'createdOrder') from jsonb_array_elements(v->'workLogs') x) then
    raise exception using errcode='P0001',message='DUPLICATE_ID';
  end if;
  delete from public.planner_work_logs where owner_id=u;
  delete from public.planner_schedules where owner_id=u;
  delete from public.planner_week_items where owner_id=u;
  delete from public.planner_weeks where owner_id=u;
  delete from public.planner_todos where owner_id=u;
  delete from public.planner_tasks where owner_id=u;
  delete from public.planner_projects where owner_id=u;
  delete from public.planner_categories where owner_id=u;
  update public.planner_settings set capacity_template=planner_private.capacity_arg(v->'settings'->'capacityTemplate'),
    updated_at=clock_timestamp() where owner_id=u;

  for item in select * from jsonb_array_elements(v->'categories') loop
    perform planner_private.put_category(u,item - 'createdAt' - 'updatedAt');
  end loop;
  for item in select * from jsonb_array_elements(v->'projects') loop
    perform planner_private.put_project(u,item - 'createdAt' - 'updatedAt');
  end loop;
  for item in select * from jsonb_array_elements(v->'tasks') loop
    if jsonb_typeof(item->'activated') is distinct from 'boolean' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_task(u,item - 'createdAt' - 'updatedAt' - 'activated');
    update public.planner_tasks set activated=(item->>'activated')::boolean where owner_id=u and id=planner_private.uuid_arg(item->'id');
  end loop;
  for item in select * from jsonb_array_elements(v->'todos') loop
    if not item ? 'completedOn' or jsonb_typeof(item->'activated') is distinct from 'boolean' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_todo(u,item - 'createdAt' - 'updatedAt' - 'completedOn' - 'activated');
    update public.planner_todos set completed_on=planner_private.date_arg(item->'completedOn'),activated=(item->>'activated')::boolean
      where owner_id=u and id=planner_private.uuid_arg(item->'id');
  end loop;
  for item in select * from jsonb_array_elements(v->'weeks') loop
    perform planner_private.shape(item,'{"weekStart":"string","capacity":"*","committedAt":"*"}');
    committed:=item->>'committedAt';
    if committed is not null then
      perform planner_private.validate_audit(jsonb_build_object('createdAt',item->'committedAt','updatedAt',item->'committedAt'));
    end if;
    insert into public.planner_weeks(owner_id,week_start,capacity,committed_at)
    values(u,planner_private.date_arg(item->'weekStart'),planner_private.capacity_arg(item->'capacity'),committed::timestamptz);
  end loop;
  for item in select * from jsonb_array_elements(v->'weekItems') loop
    if not (item ?& array['baseline','status']) or jsonb_typeof(item->'status') is distinct from 'string' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_week_item(u,item - 'createdAt' - 'updatedAt' - 'baseline' - 'status',true);
    b:=item->'baseline';
    w:=planner_private.date_arg(item->'weekStart');
    if b <> 'null'::jsonb then
      perform planner_private.shape(b,'{"minutes":"number","targetUnits":"*"}');
      if not exists(select 1 from public.planner_weeks where owner_id=u and week_start=w and committed_at is not null) then
        raise exception using errcode='P0001',message='VALIDATION';
      end if;
    end if;
    update public.planner_week_items set status=item->>'status',
      initial_minutes=case when b <> 'null'::jsonb then planner_private.minutes_arg(b->'minutes',1,10080) end,
      initial_target_units=case when b <> 'null'::jsonb then planner_private.optional_quantity(b->'targetUnits') end
      where owner_id=u and id=planner_private.uuid_arg(item->'id');
  end loop;
  for item in select * from jsonb_array_elements(v->'schedules') loop
    if jsonb_typeof(item->'position') is distinct from 'number' or jsonb_typeof(item->'outcome') is distinct from 'string' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_schedule(u,item - 'createdAt' - 'updatedAt' - 'position' - 'outcome');
  end loop;
  update public.planner_schedules s set position=planner_private.minutes_arg(x->'position',0,2147483647),outcome=x->>'outcome'
    from jsonb_array_elements(v->'schedules') x where s.owner_id=u and s.id=planner_private.uuid_arg(x->'id');
  for item in select * from jsonb_array_elements(v->'workLogs') loop
    if jsonb_typeof(item->'createdOrder') is distinct from 'number' or item->>'createdOrder' !~ '^[1-9][0-9]*$'
      or (item->>'createdOrder')::numeric > 9007199254740990 then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    perform planner_private.put_work_log(u,item - 'createdAt' - 'updatedAt' - 'createdOrder',(item->>'createdOrder')::bigint);
  end loop;
end $$;

create or replace function public.planner_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); r bigint;
begin
  r:=planner_private.lock_dataset(u);
  return jsonb_build_object('revision',r,
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'color',color,'archived',archived,'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_categories where owner_id=u),'[]'::jsonb),
    'projects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'title',title,'archived',archived,'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_projects where owner_id=u),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'projectId',project_id,'title',title,'unitName',unit_name,
      'totalUnits',total_units::text,'initialCompletedUnits',initial_completed_units::text,'initialProgressLabel',initial_progress_label,'note',note,'archived',archived,
      'priority',priority,'dueDate',to_char(due_date,'YYYY-MM-DD'),'activated',activated,'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_tasks where owner_id=u),'[]'::jsonb),
    'todos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'projectId',project_id,'title',title,
      'priority',priority,'dueDate',to_char(due_date,'YYYY-MM-DD'),'estimatedMinutes',estimated_minutes,'note',note,'archived',archived,
      'completedOn',to_char(completed_on,'YYYY-MM-DD'),'activated',activated,'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_todos where owner_id=u),'[]'::jsonb),
    'weeks',coalesce((select jsonb_agg(jsonb_build_object('weekStart',to_char(week_start,'YYYY-MM-DD'),'capacity',capacity,'committedAt',committed_at)
      order by week_start) from public.planner_weeks where owner_id=u),'[]'::jsonb),
    'weekItems',coalesce((select jsonb_agg(jsonb_build_object('id',id,'weekStart',to_char(week_start,'YYYY-MM-DD'),'taskId',task_id,'todoId',todo_id,
      'minutes',minutes,'targetUnits',target_units::text,'status',status,'baseline',case when initial_minutes is not null
        then jsonb_build_object('minutes',initial_minutes,'targetUnits',initial_target_units::text) end,'createdAt',created_at,'updatedAt',updated_at)
      order by week_start,created_at,id) from public.planner_week_items where owner_id=u),'[]'::jsonb),
    'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',to_char(date,'YYYY-MM-DD'),'taskId',task_id,'todoId',todo_id,'title',title,
      'plannedMinutes',planned_minutes,'plannedUnits',planned_units::text,'plannedRangeText',planned_range_text,'note',note,'period',period,'position',position,'outcome',outcome,'createdAt',created_at,'updatedAt',updated_at)
      order by date,case period when 'morning' then 0 when 'afternoon' then 1 else 2 end,position) from public.planner_schedules where owner_id=u),'[]'::jsonb),
    'workLogs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',to_char(date,'YYYY-MM-DD'),'taskId',task_id,'todoId',todo_id,'scheduleBlockId',schedule_block_id,
      'titleSnapshot',title_snapshot,'actualMinutes',actual_minutes,'progressDelta',progress_delta::text,'progressLabel',progress_label,'note',note,
      'createdOrder',created_order,'createdAt',created_at,'updatedAt',updated_at) order by date,created_order)
      from public.planner_work_logs where owner_id=u),'[]'::jsonb),
    'settings',(select jsonb_build_object('timezone',timezone,'dateFormat',date_format,'capacityTemplate',capacity_template)
      from public.planner_settings where owner_id=u));
end $$;

create or replace function public.planner_mutate(p_request_id uuid,p_expected_revision bigint,p_command jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); r bigint; h text; receipt public.planner_operation_receipts; v jsonb; w date; result jsonb;
begin
  r:=planner_private.lock_dataset(u);
  if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_command is null then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  h:=encode(sha256(convert_to(jsonb_build_object('revision',p_expected_revision,'command',p_command)::text,'UTF8')),'hex');
  select * into receipt from public.planner_operation_receipts where owner_id=u and request_id=p_request_id;
  if found then
    if receipt.command_hash<>h then raise exception using errcode='P0001',message='REQUEST_REUSED'; end if;
    return receipt.result;
  end if;
  if r<>p_expected_revision then raise exception using errcode='P0001',message='REVISION_CONFLICT'; end if;
  perform planner_private.shape(p_command,'{"type":"string","value":"object"}');
  v:=p_command->'value';

  case p_command->>'type'
  when 'saveCategory' then perform planner_private.put_category(u,v);
  when 'saveProject' then perform planner_private.put_project(u,v);
  when 'saveTask' then perform planner_private.put_task(u,v);
  when 'saveTodo' then perform planner_private.put_todo(u,v);
  when 'setSubjectActivated' then
    perform planner_private.shape(v,'{"id":"string","kind":"string","activated":"boolean"}');
    case v->>'kind'
    when 'task' then
      update public.planner_tasks set activated=(v->>'activated')::boolean,updated_at=clock_timestamp()
        where owner_id=u and id=planner_private.uuid_arg(v->'id');
    when 'todo' then
      update public.planner_todos set activated=(v->>'activated')::boolean,updated_at=clock_timestamp()
        where owner_id=u and id=planner_private.uuid_arg(v->'id');
    else raise exception using errcode='P0001',message='VALIDATION';
    end case;
    if not found then raise exception using errcode='P0001',message='SUBJECT_INACTIVE'; end if;
  when 'saveWeekItem' then
    update public.planner_week_items set status='active' where owner_id=u and id=planner_private.uuid_arg(v->'id')
      and status in ('returned','cancelled');
    perform planner_private.put_week_item(u,v);
  when 'setWeekItemStatus' then
    perform planner_private.shape(v,'{"id":"string","status":"string"}');
    if v->>'status' not in ('active','returned','cancelled') then raise exception using errcode='P0001',message='VALIDATION'; end if;
    update public.planner_week_items set status=v->>'status',updated_at=clock_timestamp()
      where owner_id=u and id=planner_private.uuid_arg(v->'id') and status<>'carried';
    if not found then raise exception using errcode='P0001',message='WEEK_ITEM_CHANGED'; end if;
  when 'commitWeek' then
    perform planner_private.shape(v,'{"weekStart":"string"}');
    w:=planner_private.date_arg(v->'weekStart');
    update public.planner_weeks set committed_at=clock_timestamp() where owner_id=u and week_start=w and committed_at is null;
    if not found then raise exception using errcode='P0001',message='WEEK_ALREADY_COMMITTED'; end if;
    update public.planner_week_items set initial_minutes=minutes,initial_target_units=target_units
      where owner_id=u and week_start=w and status='active';
    if not found then raise exception using errcode='P0001',message='WEEK_EMPTY'; end if;
  when 'saveWeekCapacity' then
    perform planner_private.shape(v,'{"weekStart":"string","capacity":"array"}');
    insert into public.planner_weeks(owner_id,week_start,capacity)
      values(u,planner_private.date_arg(v->'weekStart'),planner_private.capacity_arg(v->'capacity'))
      on conflict(owner_id,week_start) do update set capacity=excluded.capacity;
  when 'saveCapacityTemplate' then
    perform planner_private.shape(v,'{"capacity":"array"}');
    update public.planner_settings set capacity_template=planner_private.capacity_arg(v->'capacity'),updated_at=clock_timestamp() where owner_id=u;
  when 'saveSchedule' then
    perform planner_private.put_schedule(u,v);
    w:=planner_private.date_arg(v->'date');
    perform planner_private.ensure_week(u,w-(extract(isodow from w)::integer-1));
  when 'createScheduledEntry' then
    w:=planner_private.create_scheduled_entry(u,v);
    perform planner_private.ensure_week(u,w-(extract(isodow from w)::integer-1));
  when 'moveSchedule' then
    w:=planner_private.move_schedule(u,v);
    perform planner_private.ensure_week(u,w-(extract(isodow from w)::integer-1));
  when 'completeSchedule' then perform planner_private.complete_schedule(u,v);
  when 'setScheduleOutcome' then perform planner_private.set_schedule_outcome(u,v);
  when 'removeSchedule' then
    perform planner_private.shape(v,'{"id":"string"}');
    delete from public.planner_schedules where owner_id=u and id=planner_private.uuid_arg(v->'id');
    if not found then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
  when 'saveWorkLog' then perform planner_private.put_work_log(u,v);
  when 'removeWorkLog' then
    perform planner_private.shape(v,'{"id":"string"}');
    delete from public.planner_work_logs where owner_id=u and id=planner_private.uuid_arg(v->'id');
    if not found then raise exception using errcode='P0001',message='WORK_LOG_MISSING'; end if;
  when 'restore' then perform planner_private.restore_week_planner(u,v);
  else raise exception using errcode='P0001',message='VALIDATION';
  end case;

  perform planner_private.check_progress(u);
  r:=r+1;
  update public.planner_dataset_state set revision=r where owner_id=u;
  result:=jsonb_build_object('requestId',p_request_id,'revision',r);
  insert into public.planner_operation_receipts(owner_id,request_id,command_hash,revision,result) values(u,p_request_id,h,r,result);
  return result;
end $$;
drop function planner_private.carry_week_item(uuid,jsonb);
revoke all on all functions in schema planner_private from public,anon,authenticated;
revoke all on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) from public,anon;
grant execute on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) to authenticated;
update public.planner_dataset_state set revision=revision+1;
notify pgrst, 'reload schema';
commit;

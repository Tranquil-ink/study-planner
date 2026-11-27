-- Weekly recurring entries share the checklist references used by schedules and work logs.
begin;

alter table public.planner_todos
  add column recurs_weekly boolean not null default false,
  add column recurring_next_week date,
  add constraint planner_todo_recurrence check (
    (not recurs_weekly and recurring_next_week is null)
    or (recurs_weekly and category_id is not null and estimated_minutes is not null
      and due_date is null and completed_on is null and activated=(recurring_next_week is not null)
      and (recurring_next_week is null or (extract(isodow from recurring_next_week)=1
        and recurring_next_week between date '0001-01-01' and date '9999-12-31')))
  );

alter table public.planner_week_items
  add column recurring_completed_on date,
  add constraint planner_recurring_completion_week check (
    recurring_completed_on is null or (todo_id is not null
      and recurring_completed_on >= week_start and recurring_completed_on < week_start + 7
      and recurring_completed_on <= date '9999-12-31')
  );

create function planner_private.containing_week(d date) returns date
language sql immutable strict set search_path = '' as $$
  select d-(extract(isodow from d)::integer-1)
$$;

create or replace function planner_private.put_todo(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare row_id uuid; recurring boolean:=false;
begin
  perform planner_private.shape(v - 'recursWeekly',
    '{"id":"string","categoryId":"*","projectId":"*","title":"string","priority":"string","dueDate":"*","estimatedMinutes":"*","note":"string","archived":"boolean"}');
  if v ? 'recursWeekly' then
    if jsonb_typeof(v->'recursWeekly') is distinct from 'boolean' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    recurring:=(v->>'recursWeekly')::boolean;
  end if;
  row_id:=planner_private.uuid_arg(v->'id');
  if exists(select 1 from public.planner_todos where owner_id=u and id=row_id and recurs_weekly<>recurring) then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  insert into public.planner_todos(owner_id,id,category_id,project_id,title,priority,due_date,estimated_minutes,note,archived,recurs_weekly)
  values(u,row_id,planner_private.uuid_arg(v->'categoryId'),planner_private.uuid_arg(v->'projectId'),
    v->>'title',v->>'priority',planner_private.date_arg(v->'dueDate'),planner_private.minutes_arg(v->'estimatedMinutes',1,10080),
    v->>'note',(v->>'archived')::boolean,recurring)
  on conflict(owner_id,id) do update set category_id=excluded.category_id,project_id=excluded.project_id,title=excluded.title,
    priority=excluded.priority,due_date=excluded.due_date,estimated_minutes=excluded.estimated_minutes,
    note=excluded.note,archived=excluded.archived,updated_at=clock_timestamp();
end $$;

create function planner_private.activated_recurring(u uuid) returns setof public.planner_todos
language sql stable set search_path = '' as $$
  select t.* from public.planner_todos t
  join public.planner_categories c on (c.owner_id,c.id)=(t.owner_id,t.category_id)
  left join public.planner_projects p on (p.owner_id,p.id)=(t.owner_id,t.project_id)
  where t.owner_id=u and t.recurs_weekly and t.activated and not t.archived and not c.archived and not coalesce(p.archived,false)
$$;

create function planner_private.add_recurring_goal(u uuid,w date,subject_id uuid) returns boolean
language plpgsql set search_path = '' as $$
declare planned_minutes integer;
begin
  select estimated_minutes into planned_minutes from public.planner_todos
    where owner_id=u and id=subject_id and recurs_weekly;
  if not found or exists(select 1 from public.planner_week_items where owner_id=u and week_start=w and todo_id=subject_id) then
    return false;
  end if;
  perform planner_private.ensure_week(u,w);
  insert into public.planner_week_items(owner_id,id,week_start,todo_id,minutes)
  values(u,gen_random_uuid(),w,subject_id,planned_minutes)
  on conflict(owner_id,week_start,todo_id) do nothing;
  return found;
end $$;

-- Called under the account's dataset lock. A cursor avoids backfilling weeks while archived.
create function planner_private.sync_recurring_weeks(u uuid,w date) returns boolean
language plpgsql set search_path = '' as $$
declare pending record; changed boolean:=false;
begin
  for pending in
    select t.id,weeks.start::date as week_start from planner_private.activated_recurring(u) t
    cross join lateral generate_series(least(t.recurring_next_week,w)::timestamp,w::timestamp,interval '7 days') as weeks(start)
    where t.recurring_next_week<=w+7 and not exists(
      select 1 from public.planner_week_items i where i.owner_id=u and i.todo_id=t.id and i.week_start=weeks.start::date)
  loop
    if planner_private.add_recurring_goal(u,pending.week_start,pending.id) then changed:=true; end if;
  end loop;
  update public.planner_todos set recurring_next_week=w+7
    where owner_id=u and recurs_weekly and recurring_next_week<=w;
  return changed or found;
end $$;

create function planner_private.restore_recurring_dataset(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare row jsonb; cursor_week date; finished date; old_todos jsonb; old_goals jsonb;
begin
  if jsonb_typeof(v->'todos') is distinct from 'array' or jsonb_typeof(v->'weekItems') is distinct from 'array' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  select coalesce(jsonb_agg(x - 'recursWeekly' - 'recurringNextWeek' order by ord),'[]'::jsonb) into old_todos
    from jsonb_array_elements(v->'todos') with ordinality as t(x,ord);
  select coalesce(jsonb_agg(x - 'recurringCompletedOn' order by ord),'[]'::jsonb) into old_goals
    from jsonb_array_elements(v->'weekItems') with ordinality as t(x,ord);
  perform planner_private.restore_week_planner(u,v || jsonb_build_object('todos',old_todos,'weekItems',old_goals));
  for row in select * from jsonb_array_elements(v->'todos') loop
    if jsonb_typeof(row->'recursWeekly') is distinct from 'boolean' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    cursor_week:=planner_private.date_arg(row->'recurringNextWeek');
    update public.planner_todos set recurs_weekly=(row->>'recursWeekly')::boolean,recurring_next_week=cursor_week
      where owner_id=u and id=planner_private.uuid_arg(row->'id');
  end loop;
  for row in select * from jsonb_array_elements(v->'weekItems') loop
    finished:=planner_private.date_arg(row->'recurringCompletedOn');
    if finished is not null then
      update public.planner_week_items i set recurring_completed_on=finished
        from public.planner_todos t where i.owner_id=u and i.id=planner_private.uuid_arg(row->'id')
          and t.owner_id=u and t.id=i.todo_id and t.recurs_weekly;
      if not found then raise exception using errcode='P0001',message='VALIDATION'; end if;
    end if;
  end loop;
end $$;

create or replace function planner_private.complete_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare card public.planner_schedules; previous public.planner_work_logs;
  log_id uuid; happened date; minutes integer; reached numeric; starting numeric; delta numeric; w date;
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
  if exists(select 1 from public.planner_todos where owner_id=u and id=card.todo_id and recurs_weekly) then
    w:=planner_private.containing_week(happened);
    perform planner_private.add_recurring_goal(u,w,card.todo_id);
    update public.planner_week_items set recurring_completed_on=least(recurring_completed_on,happened),updated_at=clock_timestamp()
      where owner_id=u and week_start=w and todo_id=card.todo_id;
  elsif card.todo_id is not null then
    update public.planner_todos set completed_on=least(completed_on,happened),updated_at=clock_timestamp()
      where owner_id=u and id=card.todo_id;
  end if;
end $$;

create or replace function public.planner_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); r bigint;
begin
  r:=planner_private.lock_dataset(u);
  if planner_private.sync_recurring_weeks(u,planner_private.containing_week((statement_timestamp() at time zone 'Asia/Shanghai')::date)) then
    r:=r+1;
    update public.planner_dataset_state set revision=r where owner_id=u;
  end if;
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
      'completedOn',to_char(completed_on,'YYYY-MM-DD'),'activated',activated,
      'recursWeekly',recurs_weekly,'recurringNextWeek',to_char(recurring_next_week,'YYYY-MM-DD'),'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_todos where owner_id=u),'[]'::jsonb),
    'weeks',coalesce((select jsonb_agg(jsonb_build_object('weekStart',to_char(week_start,'YYYY-MM-DD'),'capacity',capacity,'committedAt',committed_at)
      order by week_start) from public.planner_weeks where owner_id=u),'[]'::jsonb),
    'weekItems',coalesce((select jsonb_agg(jsonb_build_object('id',id,'weekStart',to_char(week_start,'YYYY-MM-DD'),'taskId',task_id,'todoId',todo_id,
      'minutes',minutes,'targetUnits',target_units::text,'status',status,'recurringCompletedOn',to_char(recurring_completed_on,'YYYY-MM-DD'),'baseline',case when initial_minutes is not null
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
declare u uuid:=auth.uid(); r bigint; h text; receipt public.planner_operation_receipts; v jsonb; w date;
  current_week date:=planner_private.containing_week((statement_timestamp() at time zone 'Asia/Shanghai')::date);
  command_type text; active boolean; recurring_id uuid; result jsonb;
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
  command_type:=p_command->>'type';
  if command_type in ('saveCategory','saveProject','saveTodo','setSubjectActivated') then
    perform planner_private.sync_recurring_weeks(u,current_week);
  end if;

  case command_type
  when 'saveCategory' then perform planner_private.put_category(u,v);
  when 'saveProject' then perform planner_private.put_project(u,v);
  when 'saveTask' then perform planner_private.put_task(u,v);
  when 'saveTodo' then perform planner_private.put_todo(u,v);
  when 'setSubjectActivated' then
    perform planner_private.shape(v,'{"id":"string","kind":"string","activated":"boolean"}');
    active:=(v->>'activated')::boolean;
    case v->>'kind'
    when 'task' then
      update public.planner_tasks set activated=active,updated_at=clock_timestamp()
        where owner_id=u and id=planner_private.uuid_arg(v->'id');
    when 'todo','recurring' then
      update public.planner_todos set activated=active,updated_at=clock_timestamp(),
        recurring_next_week=case when recurs_weekly and active then coalesce(recurring_next_week,current_week) end
        where owner_id=u and id=planner_private.uuid_arg(v->'id') and recurs_weekly=(v->>'kind'='recurring');
    else raise exception using errcode='P0001',message='VALIDATION';
    end case;
    if not found then raise exception using errcode='P0001',message='SUBJECT_INACTIVE'; end if;
    if active and v->>'kind'='recurring' then perform planner_private.sync_recurring_weeks(u,current_week); end if;
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
    if w>=current_week then
      for recurring_id in select id from planner_private.activated_recurring(u) loop
        perform planner_private.add_recurring_goal(u,w,recurring_id);
      end loop;
    end if;
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
    perform planner_private.ensure_week(u,planner_private.containing_week(w));
  when 'createScheduledEntry' then
    w:=planner_private.create_scheduled_entry(u,v);
    perform planner_private.ensure_week(u,planner_private.containing_week(w));
  when 'moveSchedule' then
    w:=planner_private.move_schedule(u,v);
    perform planner_private.ensure_week(u,planner_private.containing_week(w));
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
  when 'restore' then perform planner_private.restore_recurring_dataset(u,v);
  else raise exception using errcode='P0001',message='VALIDATION';
  end case;

  perform planner_private.check_progress(u);
  r:=r+1;
  update public.planner_dataset_state set revision=r where owner_id=u;
  result:=jsonb_build_object('requestId',p_request_id,'revision',r);
  insert into public.planner_operation_receipts(owner_id,request_id,command_hash,revision,result) values(u,p_request_id,h,r,result);
  return result;
end $$;
revoke all on all functions in schema planner_private from public,anon,authenticated;
revoke all on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) from public,anon;
grant execute on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) to authenticated;
update public.planner_dataset_state set revision=revision+1;
notify pgrst, 'reload schema';
commit;

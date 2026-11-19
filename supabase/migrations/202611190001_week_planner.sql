-- Phase 5: day-based schedules and weekly planning. Apply after stage 4.
begin;

create table public.planner_projects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  category_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  archived boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,id),
  unique (owner_id,category_id,id),
  foreign key (owner_id,category_id) references public.planner_categories(owner_id,id)
);

alter table public.planner_tasks
  add column project_id uuid,
  add column priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  add column due_date date check (due_date between date '0001-01-01' and date '9999-12-31'),
  add foreign key (owner_id,category_id,project_id) references public.planner_projects(owner_id,category_id,id);

create table public.planner_todos (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  category_id uuid,
  project_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  priority text not null check (priority in ('normal','important','urgent')),
  due_date date check (due_date between date '0001-01-01' and date '9999-12-31'),
  estimated_minutes integer check (estimated_minutes between 1 and 10080),
  note text not null check (length(note) <= 5000),
  archived boolean not null,
  completed_on date check (completed_on between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,id),
  foreign key (owner_id,category_id) references public.planner_categories(owner_id,id),
  foreign key (owner_id,category_id,project_id) references public.planner_projects(owner_id,category_id,id),
  check (project_id is null or category_id is not null)
);

create function planner_private.valid_capacity(v integer[]) returns boolean
language sql immutable set search_path = '' as $$
  select array_ndims(v) = 1 and array_lower(v,1) = 1 and cardinality(v) = 7
    and array_position(v,null) is null and 0 <= all(v) and 1440 >= all(v)
$$;

alter table public.planner_settings add column capacity_template integer[]
  check (capacity_template is null or planner_private.valid_capacity(capacity_template) is true);

create table public.planner_weeks (
  owner_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (week_start between date '0001-01-01' and date '9999-12-31'
    and extract(isodow from week_start) = 1),
  capacity integer[] check (capacity is null or planner_private.valid_capacity(capacity) is true),
  committed_at timestamptz,
  primary key (owner_id,week_start)
);

create table public.planner_week_items (
  owner_id uuid not null,
  id uuid not null,
  week_start date not null,
  task_id uuid,
  todo_id uuid,
  minutes integer not null check (minutes between 1 and 10080),
  target_units numeric check (target_units > 0 and target_units <= 999999999.999999 and scale(target_units) <= 6),
  status text not null default 'active' check (status in ('active','returned','cancelled','carried')),
  initial_minutes integer check (initial_minutes between 1 and 10080),
  initial_target_units numeric check (initial_target_units > 0 and initial_target_units <= 999999999.999999 and scale(initial_target_units) <= 6),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,id),
  unique (owner_id,week_start,task_id),
  unique (owner_id,week_start,todo_id),
  foreign key (owner_id,week_start) references public.planner_weeks(owner_id,week_start),
  foreign key (owner_id,task_id) references public.planner_tasks(owner_id,id),
  foreign key (owner_id,todo_id) references public.planner_todos(owner_id,id),
  check (num_nonnulls(task_id,todo_id) = 1),
  check (task_id is not null or (target_units is null and initial_target_units is null)),
  check (initial_minutes is not null or initial_target_units is null)
);

-- Old test rows can stay in the same project. Only their duration survives the
-- removal of the grid; actual records keep their IDs and optional link.
drop trigger schedule_occupancy on public.planner_schedules;
drop table public.planner_schedule_slots, public.planner_schedule_cells;
alter table public.planner_schedules add column planned_minutes integer;
update public.planner_schedules set planned_minutes=end_minute-start_minute;
alter table public.planner_schedules
  drop column slot_template_version, drop column slot_ids, drop column start_minute, drop column end_minute,
  alter column planned_minutes set not null,
  add column todo_id uuid,
  add column planned_units numeric check (planned_units > 0 and planned_units <= 999999999.999999 and scale(planned_units) <= 6),
  add column resolved boolean not null default false,
  add foreign key (owner_id,todo_id) references public.planner_todos(owner_id,id),
  add check (planned_minutes between 1 and 1440),
  add check (num_nonnulls(task_id,todo_id) <= 1 and (task_id is not null or planned_units is null));

alter table public.planner_work_logs
  add column todo_id uuid,
  add foreign key (owner_id,todo_id) references public.planner_todos(owner_id,id),
  add check (num_nonnulls(task_id,todo_id) <= 1);
create index planner_day_schedule_lookup on public.planner_schedules(owner_id,date,id);
create index planner_day_log_lookup on public.planner_work_logs(owner_id,date,created_order);

drop function planner_private.merge_schedules(uuid,jsonb), planner_private.split_schedule(uuid,jsonb),
  planner_private.put_schedule(uuid,jsonb), planner_private.validate_schedule(jsonb),
  planner_private.sync_schedule_occupancy(), planner_private.valid_slots(integer,integer[],integer,integer),
  planner_private.slot_start(integer,integer), planner_private.slot_end(integer,integer);

do $$ declare t text; begin
  foreach t in array array['planner_projects','planner_todos','planner_weeks','planner_week_items'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy own_read on public.%I for select to authenticated using ((select auth.uid())=owner_id)',t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid())=owner_id)',t);
    execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',t);
    execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid())=owner_id)',t);
  end loop;
end $$;

create function planner_private.uuid_arg(v jsonb) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  return (v#>>'{}')::uuid;
end $$;

create function planner_private.date_arg(v jsonb) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (v#>>'{}')::date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  return (v#>>'{}')::date;
end $$;

create function planner_private.minutes_arg(v jsonb, low integer, high integer) returns integer
language plpgsql immutable set search_path = '' as $$
begin
  if v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) is distinct from 'number' or v#>>'{}' !~ '^[0-9]+$' or (v#>>'{}')::numeric not between low and high then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  return (v#>>'{}')::integer;
end $$;

create function planner_private.capacity_arg(v jsonb) returns integer[]
language plpgsql immutable set search_path = '' as $$
declare result integer[];
begin
  if v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)<>7 then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  select array_agg(planner_private.minutes_arg(x,0,1440) order by ord) into result
    from jsonb_array_elements(v) with ordinality as t(x,ord);
  if planner_private.valid_capacity(result) is not true then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  return result;
end $$;

create function planner_private.optional_quantity(v jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when v = 'null'::jsonb then null else planner_private.quantity(v) end
$$;

create function planner_private.put_project(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.shape(v,'{"id":"string","categoryId":"string","title":"string","archived":"boolean"}');
  insert into public.planner_projects(owner_id,id,category_id,title,archived)
  values(u,planner_private.uuid_arg(v->'id'),planner_private.uuid_arg(v->'categoryId'),v->>'title',(v->>'archived')::boolean)
  on conflict(owner_id,id) do update set category_id=excluded.category_id,title=excluded.title,
    archived=excluded.archived,updated_at=clock_timestamp();
end $$;

create or replace function planner_private.put_task(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare task uuid;
begin
  perform planner_private.validate_task(v - 'projectId' - 'priority' - 'dueDate');
  if not (v ?& array['projectId','priority','dueDate']) or jsonb_typeof(v->'priority') is distinct from 'string' then
    raise exception using errcode='P0001',message='VALIDATION';
  end if;
  task := planner_private.uuid_arg(v->'id');
  if exists(select 1 from public.planner_tasks where owner_id=u and id=task and unit_name<>v->>'unitName')
    and (exists(select 1 from public.planner_work_logs where owner_id=u and task_id=task)
      or exists(select 1 from public.planner_week_items where owner_id=u and task_id=task and (target_units is not null or initial_target_units is not null))
      or exists(select 1 from public.planner_schedules where owner_id=u and task_id=task and planned_units is not null)) then
    raise exception using errcode='P0001',message='TASK_UNIT_LOCKED';
  end if;
  insert into public.planner_tasks(owner_id,id,category_id,project_id,title,unit_name,total_units,initial_completed_units,
      initial_progress_label,note,archived,priority,due_date)
  values(u,task,planner_private.uuid_arg(v->'categoryId'),planner_private.uuid_arg(v->'projectId'),v->>'title',v->>'unitName',
    planner_private.optional_quantity(v->'totalUnits'),planner_private.quantity(v->'initialCompletedUnits'),
    v->>'initialProgressLabel',v->>'note',(v->>'archived')::boolean,v->>'priority',planner_private.date_arg(v->'dueDate'))
  on conflict(owner_id,id) do update set category_id=excluded.category_id,project_id=excluded.project_id,title=excluded.title,
    unit_name=excluded.unit_name,total_units=excluded.total_units,initial_completed_units=excluded.initial_completed_units,
    initial_progress_label=excluded.initial_progress_label,note=excluded.note,archived=excluded.archived,priority=excluded.priority,
    due_date=excluded.due_date,updated_at=clock_timestamp();
end $$;

create function planner_private.put_todo(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.shape(v,'{"id":"string","categoryId":"*","projectId":"*","title":"string","priority":"string","dueDate":"*","estimatedMinutes":"*","note":"string","archived":"boolean"}');
  insert into public.planner_todos(owner_id,id,category_id,project_id,title,priority,due_date,estimated_minutes,note,archived)
  values(u,planner_private.uuid_arg(v->'id'),planner_private.uuid_arg(v->'categoryId'),planner_private.uuid_arg(v->'projectId'),
    v->>'title',v->>'priority',planner_private.date_arg(v->'dueDate'),planner_private.minutes_arg(v->'estimatedMinutes',1,10080),
    v->>'note',(v->>'archived')::boolean)
  on conflict(owner_id,id) do update set category_id=excluded.category_id,project_id=excluded.project_id,title=excluded.title,
    priority=excluded.priority,due_date=excluded.due_date,estimated_minutes=excluded.estimated_minutes,
    note=excluded.note,archived=excluded.archived,updated_at=clock_timestamp();
end $$;

create function planner_private.ensure_week(u uuid,w date) returns void
language sql set search_path = '' as $$
  insert into public.planner_weeks(owner_id,week_start,capacity)
  select u,w,case when w + 7 > (statement_timestamp() at time zone 'Asia/Shanghai')::date then capacity_template end
  from public.planner_settings where owner_id=u
  on conflict(owner_id,week_start) do nothing
$$;

create function planner_private.put_week_item(u uuid,v jsonb,restoring boolean default false) returns void
language plpgsql set search_path = '' as $$
declare row_id uuid; w date; task uuid; todo uuid;
begin
  perform planner_private.shape(v,'{"id":"string","weekStart":"string","taskId":"*","todoId":"*","minutes":"number","targetUnits":"*"}');
  row_id:=planner_private.uuid_arg(v->'id');
  w:=planner_private.date_arg(v->'weekStart');
  task:=planner_private.uuid_arg(v->'taskId');
  todo:=planner_private.uuid_arg(v->'todoId');
  if not restoring then
    if not exists(select 1 from public.planner_week_items where owner_id=u and id=row_id) and (
      exists(select 1 from public.planner_tasks where owner_id=u and id=task and archived)
      or exists(select 1 from public.planner_todos where owner_id=u and id=todo and (archived or completed_on is not null))) then
      raise exception using errcode='P0001',message='SUBJECT_INACTIVE';
    end if;
    perform planner_private.ensure_week(u,w);
  end if;
  insert into public.planner_week_items(owner_id,id,week_start,task_id,todo_id,minutes,target_units)
  values(u,row_id,w,task,todo,planner_private.minutes_arg(v->'minutes',1,10080),planner_private.optional_quantity(v->'targetUnits'))
  on conflict(owner_id,id) do update set minutes=excluded.minutes,target_units=excluded.target_units,updated_at=clock_timestamp()
  where planner_week_items.week_start=excluded.week_start and planner_week_items.status='active'
    and planner_week_items.task_id is not distinct from excluded.task_id
    and planner_week_items.todo_id is not distinct from excluded.todo_id;
  if not found then raise exception using errcode='P0001',message='WEEK_ITEM_CHANGED'; end if;
end $$;

create function planner_private.carry_week_item(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
declare original public.planner_week_items; proposed jsonb:=v->'next';
begin
  perform planner_private.shape(v,'{"id":"string","next":"object"}');
  select * into original from public.planner_week_items where owner_id=u and id=planner_private.uuid_arg(v->'id') and status='active';
  if not found or planner_private.date_arg(proposed->'weekStart') is distinct from original.week_start + 7
    or planner_private.uuid_arg(proposed->'taskId') is distinct from original.task_id
    or planner_private.uuid_arg(proposed->'todoId') is distinct from original.todo_id then
    raise exception using errcode='P0001',message='WEEK_ITEM_CHANGED';
  end if;
  if exists(select 1 from public.planner_week_items where owner_id=u and
    (id=planner_private.uuid_arg(proposed->'id') or (week_start=original.week_start+7 and
      task_id is not distinct from original.task_id and todo_id is not distinct from original.todo_id))) then
    raise exception using errcode='P0001',message='NEXT_WEEK_EXISTS';
  end if;
  perform planner_private.put_week_item(u,proposed);
  update public.planner_week_items set status='carried',updated_at=clock_timestamp() where owner_id=u and id=original.id;
end $$;

create or replace function planner_private.detach_work_logs() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP='DELETE' then
    update public.planner_work_logs set schedule_block_id=null,updated_at=clock_timestamp()
      where owner_id=old.owner_id and schedule_block_id=old.id;
    return old;
  end if;
  if new.task_id is distinct from old.task_id or new.todo_id is distinct from old.todo_id then
    update public.planner_work_logs set schedule_block_id=null,updated_at=clock_timestamp()
      where owner_id=old.owner_id and schedule_block_id=old.id;
  end if;
  return new;
end $$;

create function planner_private.put_schedule(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.shape(v,'{"id":"string","date":"string","taskId":"*","todoId":"*","title":"string","plannedMinutes":"number","plannedUnits":"*","plannedRangeText":"string","note":"string","resolved":"boolean"}');
  insert into public.planner_schedules(owner_id,id,date,task_id,todo_id,title,planned_minutes,planned_units,planned_range_text,note,resolved)
  values(u,planner_private.uuid_arg(v->'id'),planner_private.date_arg(v->'date'),planner_private.uuid_arg(v->'taskId'),
    planner_private.uuid_arg(v->'todoId'),v->>'title',planner_private.minutes_arg(v->'plannedMinutes',1,1440),
    planner_private.optional_quantity(v->'plannedUnits'),v->>'plannedRangeText',v->>'note',(v->>'resolved')::boolean)
  on conflict(owner_id,id) do update set date=excluded.date,task_id=excluded.task_id,todo_id=excluded.todo_id,title=excluded.title,
    planned_minutes=excluded.planned_minutes,planned_units=excluded.planned_units,planned_range_text=excluded.planned_range_text,
    note=excluded.note,resolved=excluded.resolved,updated_at=clock_timestamp();
end $$;

create or replace function planner_private.put_work_log(u uuid,v jsonb,restore_order bigint default null) returns void
language plpgsql set search_path = '' as $$
declare n bigint; todo uuid;
begin
  perform planner_private.validate_work_log(v - 'todoId');
  if not v ? 'todoId' then raise exception using errcode='P0001',message='VALIDATION'; end if;
  todo:=planner_private.uuid_arg(v->'todoId');
  if v->'scheduleBlockId' <> 'null'::jsonb and not exists(select 1 from public.planner_schedules
    where owner_id=u and id=(v->>'scheduleBlockId')::uuid and task_id is not distinct from (v->>'taskId')::uuid
      and todo_id is not distinct from todo) then
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
  insert into public.planner_work_logs(owner_id,id,date,task_id,todo_id,schedule_block_id,title_snapshot,actual_minutes,progress_delta,progress_label,note,created_order)
  values(u,(v->>'id')::uuid,(v->>'date')::date,(v->>'taskId')::uuid,todo,(v->>'scheduleBlockId')::uuid,v->>'titleSnapshot',
    (v->>'actualMinutes')::integer,(v->>'progressDelta')::numeric,v->>'progressLabel',v->>'note',n)
  on conflict(owner_id,id) do update set date=excluded.date,task_id=excluded.task_id,todo_id=excluded.todo_id,
    schedule_block_id=excluded.schedule_block_id,title_snapshot=excluded.title_snapshot,actual_minutes=excluded.actual_minutes,
    progress_delta=excluded.progress_delta,progress_label=excluded.progress_label,note=excluded.note,updated_at=clock_timestamp();
end $$;

create function planner_private.restore_week_planner(u uuid,v jsonb) returns void
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
    perform planner_private.put_task(u,item - 'createdAt' - 'updatedAt');
  end loop;
  for item in select * from jsonb_array_elements(v->'todos') loop
    if not item ? 'completedOn' then raise exception using errcode='P0001',message='VALIDATION'; end if;
    perform planner_private.put_todo(u,item - 'createdAt' - 'updatedAt' - 'completedOn');
    update public.planner_todos set completed_on=planner_private.date_arg(item->'completedOn')
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
    perform planner_private.put_schedule(u,item - 'createdAt' - 'updatedAt');
  end loop;
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
      'priority',priority,'dueDate',to_char(due_date,'YYYY-MM-DD'),'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_tasks where owner_id=u),'[]'::jsonb),
    'todos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'projectId',project_id,'title',title,
      'priority',priority,'dueDate',to_char(due_date,'YYYY-MM-DD'),'estimatedMinutes',estimated_minutes,'note',note,'archived',archived,
      'completedOn',to_char(completed_on,'YYYY-MM-DD'),'createdAt',created_at,'updatedAt',updated_at)
      order by created_at,id) from public.planner_todos where owner_id=u),'[]'::jsonb),
    'weeks',coalesce((select jsonb_agg(jsonb_build_object('weekStart',to_char(week_start,'YYYY-MM-DD'),'capacity',capacity,'committedAt',committed_at)
      order by week_start) from public.planner_weeks where owner_id=u),'[]'::jsonb),
    'weekItems',coalesce((select jsonb_agg(jsonb_build_object('id',id,'weekStart',to_char(week_start,'YYYY-MM-DD'),'taskId',task_id,'todoId',todo_id,
      'minutes',minutes,'targetUnits',target_units::text,'status',status,'baseline',case when initial_minutes is not null
        then jsonb_build_object('minutes',initial_minutes,'targetUnits',initial_target_units::text) end,'createdAt',created_at,'updatedAt',updated_at)
      order by week_start,created_at,id) from public.planner_week_items where owner_id=u),'[]'::jsonb),
    'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',to_char(date,'YYYY-MM-DD'),'taskId',task_id,'todoId',todo_id,'title',title,
      'plannedMinutes',planned_minutes,'plannedUnits',planned_units::text,'plannedRangeText',planned_range_text,'note',note,'resolved',resolved,'createdAt',created_at,'updatedAt',updated_at)
      order by date,created_at,id) from public.planner_schedules where owner_id=u),'[]'::jsonb),
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
  when 'completeTodo' then
    perform planner_private.shape(v,'{"id":"string","completed":"boolean"}');
    update public.planner_todos set completed_on=case when (v->>'completed')::boolean
      then coalesce(completed_on,(statement_timestamp() at time zone 'Asia/Shanghai')::date) end,updated_at=clock_timestamp()
      where owner_id=u and id=planner_private.uuid_arg(v->'id');
    if not found then raise exception using errcode='P0001',message='SUBJECT_INACTIVE'; end if;
  when 'saveWeekItem' then perform planner_private.put_week_item(u,v);
  when 'setWeekItemStatus' then
    perform planner_private.shape(v,'{"id":"string","status":"string"}');
    if v->>'status' not in ('active','returned','cancelled') then raise exception using errcode='P0001',message='VALIDATION'; end if;
    update public.planner_week_items set status=v->>'status',updated_at=clock_timestamp()
      where owner_id=u and id=planner_private.uuid_arg(v->'id') and status<>'carried';
    if not found then raise exception using errcode='P0001',message='WEEK_ITEM_CHANGED'; end if;
  when 'carryWeekItem' then perform planner_private.carry_week_item(u,v);
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
  when 'resolveSchedule' then
    perform planner_private.shape(v,'{"id":"string","resolved":"boolean"}');
    update public.planner_schedules set resolved=(v->>'resolved')::boolean,updated_at=clock_timestamp()
      where owner_id=u and id=planner_private.uuid_arg(v->'id');
    if not found then raise exception using errcode='P0001',message='SCHEDULE_MISSING'; end if;
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
revoke all on all functions in schema planner_private from public,anon,authenticated;
revoke all on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) from public,anon;
grant execute on function public.planner_snapshot(),public.planner_receipt(uuid),public.planner_mutate(uuid,bigint,jsonb) to authenticated;
update public.planner_dataset_state set revision=revision+1;
notify pgrst, 'reload schema';
commit;

-- Stage 1. Apply once using the Supabase SQL editor or CLI migrations.
begin;
create schema if not exists planner_private;
revoke all on schema planner_private from public, anon, authenticated;

create table public.planner_dataset_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision between 0 and 9007199254740990)
);
create table public.planner_categories (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, name text not null check (length(btrim(name)) between 1 and 100),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (owner_id,id)
);
create table public.planner_tasks (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, category_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  unit_name text not null check (length(btrim(unit_name)) between 1 and 20),
  -- Unconstrained numeric avoids implicit rounding before CHECK.
  total_units numeric check (total_units >= 0 and total_units <= 999999999.999999 and scale(total_units) <= 6),
  initial_completed_units numeric not null check (initial_completed_units >= 0 and initial_completed_units <= 999999999.999999 and scale(initial_completed_units) <= 6),
  initial_progress_label text not null check (length(initial_progress_label) <= 200),
  note text not null check (length(note) <= 5000), archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (owner_id,id),
  foreign key (owner_id,category_id) references public.planner_categories(owner_id,id),
  check (total_units is null or initial_completed_units <= total_units)
);
create table public.planner_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai' check (timezone = 'Asia/Shanghai'),
  date_format text not null default 'YYYY-MM-DD' check (date_format = 'YYYY-MM-DD'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.planner_operation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null, command_hash text not null,
  revision bigint not null, result jsonb not null,
  committed_at timestamptz not null default now(), primary key(owner_id,request_id)
);

-- All tables, including internal state and receipts, are owner-scoped.
do $$ declare t text; begin
  foreach t in array array['planner_dataset_state','planner_categories','planner_tasks','planner_settings','planner_operation_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy own_read on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)', t);
    execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
    execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)', t);
  end loop;
end $$;

-- Required exact keys and JSON types: never accept client-supplied ownership.
create function planner_private.shape(v jsonb, spec jsonb) returns void
language plpgsql set search_path = '' as $$
declare k text; kind text;
begin
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v)) <> (select count(*) from jsonb_object_keys(spec)) then
    raise exception using errcode='P0001', message='VALIDATION';
  end if;
  for k,kind in select * from jsonb_each_text(spec) loop
    if not v ? k or (kind <> '*' and jsonb_typeof(v->k) is distinct from kind) then
      raise exception using errcode='P0001', message='VALIDATION';
    end if;
  end loop;
end $$;
create function planner_private.quantity(v jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' then
    raise exception using errcode='P0001', message='VALIDATION';
  end if;
  return (v#>>'{}')::numeric;
end $$;
create function planner_private.validate_category(v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.shape(v,'{"id":"string","name":"string","color":"string","archived":"boolean"}');
  if v->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or length(btrim(v->>'name')) not between 1 and 100 or v->>'color' !~ '^#[0-9a-fA-F]{6}$' then
    raise exception using errcode='P0001', message='VALIDATION';
  end if;
end $$;
create function planner_private.validate_task(v jsonb) returns void
language plpgsql set search_path = '' as $$
declare n numeric; total numeric;
begin
  perform planner_private.shape(v,'{"id":"string","categoryId":"string","title":"string","unitName":"string","totalUnits":"*","initialCompletedUnits":"string","initialProgressLabel":"string","note":"string","archived":"boolean"}');
  if v->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or v->>'categoryId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or length(btrim(v->>'title')) not between 1 and 200 or length(btrim(v->>'unitName')) not between 1 and 20
    or length(v->>'initialProgressLabel') > 200 or length(v->>'note') > 5000 then
    raise exception using errcode='P0001', message='VALIDATION';
  end if;
  n := planner_private.quantity(v->'initialCompletedUnits');
  if v->'totalUnits' <> 'null'::jsonb then
    total := planner_private.quantity(v->'totalUnits');
    if n > total then raise exception using errcode='P0001', message='PROGRESS_LIMIT'; end if;
  end if;
end $$;
create function planner_private.validate_audit(v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(v->'createdAt') is distinct from 'string' or jsonb_typeof(v->'updatedAt') is distinct from 'string'
     or v->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
     or v->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
     or (v->>'updatedAt')::timestamptz < (v->>'createdAt')::timestamptz then
    raise exception using errcode='P0001', message='VALIDATION';
  end if;
end $$;
create function planner_private.put_category(u uuid, v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.validate_category(v);
  insert into public.planner_categories(owner_id,id,name,color,archived)
  values(u,(v->>'id')::uuid,v->>'name',v->>'color',(v->>'archived')::boolean)
  on conflict(owner_id,id) do update set name=excluded.name,color=excluded.color,archived=excluded.archived,updated_at=clock_timestamp();
end $$;
create function planner_private.put_task(u uuid,v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform planner_private.validate_task(v);
  insert into public.planner_tasks(owner_id,id,category_id,title,unit_name,total_units,initial_completed_units,initial_progress_label,note,archived)
  values(u,(v->>'id')::uuid,(v->>'categoryId')::uuid,v->>'title',v->>'unitName',(v->>'totalUnits')::numeric,(v->>'initialCompletedUnits')::numeric,v->>'initialProgressLabel',v->>'note',(v->>'archived')::boolean)
  on conflict(owner_id,id) do update set category_id=excluded.category_id,title=excluded.title,unit_name=excluded.unit_name,total_units=excluded.total_units,
    initial_completed_units=excluded.initial_completed_units,initial_progress_label=excluded.initial_progress_label,note=excluded.note,archived=excluded.archived,updated_at=clock_timestamp();
end $$;
create function planner_private.lock_dataset(u uuid) returns bigint
language plpgsql set search_path = '' as $$
declare r bigint;
begin
  if u is null then raise exception using errcode='P0001',message='AUTH_REQUIRED'; end if;
  insert into public.planner_dataset_state(owner_id) values(u) on conflict do nothing;
  select revision into r from public.planner_dataset_state where owner_id=u for update;
  insert into public.planner_settings(owner_id) values(u) on conflict do nothing;
  return r;
end $$;

create function public.planner_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); r bigint; result jsonb;
begin
  r := planner_private.lock_dataset(u);
  select jsonb_build_object('revision',r,'categories',
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'color',color,'archived',archived,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.planner_categories where owner_id=u),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'title',title,'unitName',unit_name,'totalUnits',total_units::text,'initialCompletedUnits',initial_completed_units::text,'initialProgressLabel',initial_progress_label,'note',note,'archived',archived,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.planner_tasks where owner_id=u),'[]'::jsonb),
    'settings',(select jsonb_build_object('timezone',timezone,'dateFormat',date_format) from public.planner_settings where owner_id=u)) into result;
  return result;
end $$;
create function public.planner_receipt(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb; u uuid := auth.uid();
begin
  if u is null then raise exception using errcode='P0001',message='AUTH_REQUIRED'; end if;
  select result_value.result into result from public.planner_operation_receipts result_value where owner_id=u and request_id=p_request_id;
  return result;
end $$;

create function public.planner_mutate(p_request_id uuid,p_expected_revision bigint,p_command jsonb) returns jsonb
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
  when 'restore' then
    perform planner_private.shape(v,'{"categories":"array","tasks":"array","settings":"object"}');
    perform planner_private.shape(v->'settings','{"timezone":"string","dateFormat":"string"}');
    if v->'settings'->>'timezone' <> 'Asia/Shanghai' or v->'settings'->>'dateFormat' <> 'YYYY-MM-DD' then
      raise exception using errcode='P0001',message='VALIDATION';
    end if;
    if (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'categories') x)
      or (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(v->'tasks') x) then
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
    delete from public.planner_tasks where owner_id=u;
    delete from public.planner_categories where owner_id=u;
    for item in select * from jsonb_array_elements(v->'categories') loop
      perform planner_private.put_category(u,item - 'createdAt' - 'updatedAt');
    end loop;
    for item in select * from jsonb_array_elements(v->'tasks') loop
      perform planner_private.put_task(u,item - 'createdAt' - 'updatedAt');
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
commit;

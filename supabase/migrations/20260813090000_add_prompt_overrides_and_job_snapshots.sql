create unique index if not exists prompt_templates_one_system_per_type_idx
  on public.prompt_templates(processing_type)
  where is_system = true;

create table public.prompt_template_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  system_prompt_id uuid not null references public.prompt_templates(id) on delete restrict,
  prompt_text text not null check (char_length(btrim(prompt_text)) between 20 and 20000),
  is_active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_template_overrides_owner_base_unique unique (user_id, system_prompt_id),
  constraint prompt_template_overrides_id_user_unique unique (id, user_id)
);

create trigger prompt_template_overrides_set_updated_at
before update on public.prompt_template_overrides
for each row execute function public.set_updated_at();

-- validate_prompt_template_override_base_v1 preserves the immutable owner/base identity and monotonic revisions.
create function public.validate_prompt_template_override_base_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.revision <> 1 then
    raise exception 'invalid initial prompt override revision' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
    new.user_id <> old.user_id or
    new.system_prompt_id <> old.system_prompt_id or
    new.revision <> old.revision + 1
  ) then
    raise exception 'invalid prompt override revision transition' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.prompt_templates p
    where p.id = new.system_prompt_id
      and p.is_system = true
      and p.processing_type in (
        'summary', 'action_items', 'timeline_chapters',
        'meeting_minutes', 'crm_note', 'follow_up_email'
      )
  ) then
    raise exception 'invalid system prompt override base' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger prompt_template_overrides_validate_base
before insert or update on public.prompt_template_overrides
for each row execute function public.validate_prompt_template_override_base_v1();

alter table public.prompt_template_overrides enable row level security;
alter table public.prompt_template_overrides force row level security;

create policy "prompt overrides select own"
on public.prompt_template_overrides for select to authenticated
using ((select auth.uid()) = user_id);

create policy "prompt overrides insert own"
on public.prompt_template_overrides for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "prompt overrides update own"
on public.prompt_template_overrides for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.prompt_template_overrides from anon;
revoke all on table public.prompt_template_overrides from public;
grant select, insert, update on table public.prompt_template_overrides to authenticated;
grant all on table public.prompt_template_overrides to service_role;

-- save_prompt_template_override_v1 creates or updates one prompt-text override with optimistic concurrency.
create function public.save_prompt_template_override_v1(
  p_system_prompt_id uuid,
  p_prompt_text text,
  p_expected_revision integer
)
returns public.prompt_template_overrides
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.prompt_template_overrides;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid expected prompt override revision' using errcode = '22023';
  end if;

  if char_length(btrim(p_prompt_text)) not between 20 and 20000 then
    raise exception 'invalid prompt text' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.prompt_templates p
    where p.id = p_system_prompt_id
      and p.is_system = true
      and p.processing_type in (
        'summary', 'action_items', 'timeline_chapters',
        'meeting_minutes', 'crm_note', 'follow_up_email'
      )
  ) then
    raise exception 'system prompt not found' using errcode = 'P0002';
  end if;

  select * into v_current
  from public.prompt_template_overrides o
  where o.user_id = v_user_id
    and o.system_prompt_id = p_system_prompt_id
  for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception 'prompt override conflict' using errcode = '40001';
    end if;

    begin
      insert into public.prompt_template_overrides (
        user_id,
        system_prompt_id,
        prompt_text,
        is_active,
        revision
      ) values (
        v_user_id,
        p_system_prompt_id,
        btrim(p_prompt_text),
        true,
        1
      )
      returning * into v_current;
    exception
      when unique_violation then
        raise exception 'prompt override conflict' using errcode = '40001';
    end;
  else
    if v_current.is_active = false and p_expected_revision = 0 then
      update public.prompt_template_overrides
      set prompt_text = btrim(p_prompt_text),
          is_active = true,
          revision = revision + 1
      where id = v_current.id
        and user_id = v_user_id
      returning * into v_current;
      return v_current;
    end if;

    if v_current.revision <> p_expected_revision then
      raise exception 'prompt override conflict' using errcode = '40001';
    end if;

    update public.prompt_template_overrides
    set prompt_text = btrim(p_prompt_text),
        is_active = true,
        revision = revision + 1
    where id = v_current.id
      and user_id = v_user_id
    returning * into v_current;
  end if;

  return v_current;
end;
$$;

-- reset_prompt_template_override_v1 deactivates the current override without deleting its revision history.
create function public.reset_prompt_template_override_v1(
  p_system_prompt_id uuid,
  p_expected_revision integer
)
returns public.prompt_template_overrides
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.prompt_template_overrides;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_expected_revision is null or p_expected_revision <= 0 then
    raise exception 'invalid expected prompt reset revision' using errcode = '22023';
  end if;

  select * into v_current
  from public.prompt_template_overrides o
  where o.user_id = v_user_id
    and o.system_prompt_id = p_system_prompt_id
  for update;

  if not found or v_current.revision <> p_expected_revision then
    raise exception 'prompt override conflict' using errcode = '40001';
  end if;

  update public.prompt_template_overrides
  set is_active = false,
      revision = revision + 1
  where id = v_current.id
    and user_id = v_user_id
  returning * into v_current;

  return v_current;
end;
$$;

-- resolve_effective_prompt_template_v1 combines an owner override with the authoritative system schema.
create function public.resolve_effective_prompt_template_v1(
  p_processing_type public.ai_processing_type
)
returns table (
  system_prompt_id uuid,
  override_id uuid,
  name text,
  processing_type public.ai_processing_type,
  prompt_text text,
  output_schema jsonb,
  source text,
  revision integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    o.id,
    p.name,
    p.processing_type,
    coalesce(o.prompt_text, p.prompt_text),
    p.output_schema,
    case when o.id is null then 'system' else 'user_override' end,
    o.revision
  from public.prompt_templates p
  left join public.prompt_template_overrides o
    on o.system_prompt_id = p.id
    and o.user_id = auth.uid()
    and o.is_active = true
  where p.is_system = true
    and p.processing_type = p_processing_type
    and p_processing_type in (
      'summary', 'action_items', 'timeline_chapters',
      'meeting_minutes', 'crm_note', 'follow_up_email'
    )
  limit 1;
$$;

revoke all on function public.save_prompt_template_override_v1(uuid,text,integer) from public, anon;
revoke all on function public.reset_prompt_template_override_v1(uuid,integer) from public, anon;
revoke all on function public.resolve_effective_prompt_template_v1(public.ai_processing_type) from public, anon;
grant execute on function public.save_prompt_template_override_v1(uuid,text,integer) to authenticated;
grant execute on function public.reset_prompt_template_override_v1(uuid,integer) to authenticated;
grant execute on function public.resolve_effective_prompt_template_v1(public.ai_processing_type) to authenticated;

alter table public.ai_processing_jobs
  add column prompt_override_id uuid,
  add column prompt_source text,
  add column prompt_name_snapshot text,
  add column prompt_text_snapshot text,
  add column prompt_output_schema_snapshot jsonb,
  add column prompt_revision_snapshot integer,
  add column prompt_snapshot_exact boolean not null default true,
  add constraint ai_processing_jobs_prompt_source_check
    check (prompt_source is null or prompt_source in (
      'system', 'user_override', 'legacy_user_template', 'unknown'
    )),
  add constraint ai_processing_jobs_prompt_revision_check
    check (prompt_revision_snapshot is null or prompt_revision_snapshot > 0),
  add constraint ai_processing_jobs_override_user_fk
    foreign key (prompt_override_id, user_id)
    references public.prompt_template_overrides(id, user_id) on delete restrict;

-- fill_legacy_ai_processing_job_prompt_snapshot_v1 expands old app inserts before snapshot constraints run.
create function public.fill_legacy_ai_processing_job_prompt_snapshot_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prompt public.prompt_templates%rowtype;
begin
  if new.prompt_source is null
    and new.prompt_name_snapshot is null
    and new.prompt_text_snapshot is null
    and new.prompt_output_schema_snapshot is null then
    select p.*
    into v_prompt
    from public.prompt_templates p
    where p.id = new.prompt_id;

    new.prompt_override_id := null;
    new.prompt_revision_snapshot := null;

    if found then
      new.prompt_source := case
        when v_prompt.is_system then 'system'
        else 'legacy_user_template'
      end;
      new.prompt_name_snapshot := v_prompt.name;
      new.prompt_text_snapshot := v_prompt.prompt_text;
      new.prompt_output_schema_snapshot := v_prompt.output_schema;
      new.prompt_snapshot_exact := true;
    else
      new.prompt_source := 'unknown';
      new.prompt_snapshot_exact := false;
    end if;
  end if;

  return new;
end;
$$;

create trigger ai_processing_jobs_fill_legacy_prompt_snapshot
before insert on public.ai_processing_jobs
for each row execute function public.fill_legacy_ai_processing_job_prompt_snapshot_v1();

revoke execute on function public.fill_legacy_ai_processing_job_prompt_snapshot_v1()
from public, anon, authenticated;

update public.ai_processing_jobs j
set prompt_source = case when p.is_system then 'system' else 'legacy_user_template' end,
    prompt_name_snapshot = p.name,
    prompt_text_snapshot = p.prompt_text,
    prompt_output_schema_snapshot = p.output_schema,
    prompt_snapshot_exact = false
from public.prompt_templates p
where j.prompt_id = p.id;

update public.ai_processing_jobs
set prompt_source = 'unknown',
    prompt_snapshot_exact = false
where prompt_source is null;

alter table public.ai_processing_jobs
  alter column prompt_source set not null,
  add constraint ai_processing_jobs_exact_snapshot_check
    check (
      prompt_snapshot_exact = false or
      (prompt_name_snapshot is not null and prompt_text_snapshot is not null)
    );

create index ai_processing_jobs_prompt_override_idx
  on public.ai_processing_jobs(prompt_override_id)
  where prompt_override_id is not null;

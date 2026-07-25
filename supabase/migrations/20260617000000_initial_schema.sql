-- Vosio initial Supabase schema baseline.
-- This file replaces the early development migration chain for fresh projects.
-- Existing production projects must not be reset to this baseline without a data migration plan.

-- Vosio core schema for recordings, transcripts, AI processing, prompts, audit logs, and private audio storage.

create extension if not exists pgcrypto;

do $$
begin
  create type public.recording_source_type as enum ('upload', 'in_app_recording', 'realtime');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.recording_status as enum ('created', 'uploading', 'uploaded', 'transcribing', 'completed', 'failed', 'deleted');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.recording_retention_policy as enum ('keep', 'delete_audio_after_transcription');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.transcription_provider as enum ('soniox');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.transcription_mode as enum ('async', 'realtime');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.job_status as enum ('queued', 'running', 'done', 'failed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ai_provider as enum ('openai', 'gemini');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ai_processing_type as enum (
    'summary',
    'action_items',
    'meeting_minutes',
    'structured_extraction',
    'crm_note',
    'follow_up_email',
    'custom_prompt',
    'timeline_chapters'
  );
exception
  when duplicate_object then null;
end $$;

-- set_updated_at refreshes updated_at timestamps for Vosio public tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type public.recording_source_type not null,
  storage_path text,
  mime_type text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  status public.recording_status not null default 'created',
  retention_policy public.recording_retention_policy not null default 'keep',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recordings_id_user_id_unique unique (id, user_id),
  constraint recordings_storage_path_owner_check
    check (storage_path is null or storage_path like (user_id::text || '/%'))
);

create table public.transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.transcription_provider not null default 'soniox',
  provider_job_id text,
  provider_config jsonb not null default '{}'::jsonb,
  mode public.transcription_mode not null,
  status public.job_status not null default 'queued',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcription_jobs_id_user_id_unique unique (id, user_id),
  constraint transcription_jobs_recording_user_fk
    foreign key (recording_id, user_id) references public.recordings(id, user_id) on delete cascade
);

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null,
  transcription_job_id uuid references public.transcription_jobs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  language text,
  raw_text text not null default '',
  segments jsonb not null default '[]'::jsonb,
  speakers jsonb not null default '[]'::jsonb,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  constraint transcripts_id_user_id_unique unique (id, user_id),
  constraint transcripts_recording_user_fk
    foreign key (recording_id, user_id) references public.recordings(id, user_id) on delete cascade
);

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  processing_type public.ai_processing_type not null,
  prompt_text text not null,
  output_schema jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_templates_owner_check
    check ((is_system = true and user_id is null) or (is_system = false and user_id is not null))
);

create table public.ai_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.ai_provider not null default 'openai',
  model text not null,
  processing_type public.ai_processing_type not null,
  prompt_id uuid references public.prompt_templates(id) on delete set null,
  provider_config jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  input_token_count integer check (input_token_count is null or input_token_count >= 0),
  output_token_count integer check (output_token_count is null or output_token_count >= 0),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_processing_jobs_id_user_id_unique unique (id, user_id),
  constraint ai_processing_jobs_transcript_user_fk
    foreign key (transcript_id, user_id) references public.transcripts(id, user_id) on delete cascade
);

create table public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  processing_job_id uuid not null,
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  output_text text,
  output_json jsonb,
  created_at timestamptz not null default now(),
  constraint ai_outputs_processing_job_user_fk
    foreign key (processing_job_id, user_id) references public.ai_processing_jobs(id, user_id) on delete cascade,
  constraint ai_outputs_transcript_user_fk
    foreign key (transcript_id, user_id) references public.transcripts(id, user_id) on delete cascade,
  constraint ai_outputs_has_content_check
    check (output_text is not null or output_json is not null)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create trigger recordings_set_updated_at
before update on public.recordings
for each row execute function public.set_updated_at();

create trigger transcription_jobs_set_updated_at
before update on public.transcription_jobs
for each row execute function public.set_updated_at();

create trigger prompt_templates_set_updated_at
before update on public.prompt_templates
for each row execute function public.set_updated_at();

create trigger ai_processing_jobs_set_updated_at
before update on public.ai_processing_jobs
for each row execute function public.set_updated_at();

create unique index recordings_storage_path_unique_idx
  on public.recordings(storage_path)
  where storage_path is not null;

create index recordings_user_status_created_idx
  on public.recordings(user_id, status, created_at desc);

create unique index transcription_jobs_provider_job_unique_idx
  on public.transcription_jobs(provider, provider_job_id)
  where provider_job_id is not null;

create index transcription_jobs_user_status_created_idx
  on public.transcription_jobs(user_id, status, created_at desc);

create index transcription_jobs_recording_idx
  on public.transcription_jobs(recording_id);

create index transcripts_user_created_idx
  on public.transcripts(user_id, created_at desc);

create index transcripts_recording_idx
  on public.transcripts(recording_id);

create index prompt_templates_user_type_idx
  on public.prompt_templates(user_id, processing_type, created_at desc);

create index ai_processing_jobs_user_status_created_idx
  on public.ai_processing_jobs(user_id, status, created_at desc);

create index ai_processing_jobs_transcript_idx
  on public.ai_processing_jobs(transcript_id);

create index ai_outputs_user_created_idx
  on public.ai_outputs(user_id, created_at desc);

create index ai_outputs_transcript_idx
  on public.ai_outputs(transcript_id);

create index audit_logs_user_created_idx
  on public.audit_logs(user_id, created_at desc);

alter table public.recordings enable row level security;
alter table public.transcription_jobs enable row level security;
alter table public.transcripts enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.ai_processing_jobs enable row level security;
alter table public.ai_outputs enable row level security;
alter table public.audit_logs enable row level security;

alter table public.recordings force row level security;
alter table public.transcription_jobs force row level security;
alter table public.transcripts force row level security;
alter table public.prompt_templates force row level security;
alter table public.ai_processing_jobs force row level security;
alter table public.ai_outputs force row level security;
alter table public.audit_logs force row level security;

grant usage on schema public to authenticated, service_role;
grant usage on type public.recording_source_type to authenticated, service_role;
grant usage on type public.recording_status to authenticated, service_role;
grant usage on type public.recording_retention_policy to authenticated, service_role;
grant usage on type public.transcription_provider to authenticated, service_role;
grant usage on type public.transcription_mode to authenticated, service_role;
grant usage on type public.job_status to authenticated, service_role;
grant usage on type public.ai_provider to authenticated, service_role;
grant usage on type public.ai_processing_type to authenticated, service_role;

grant select, insert, update, delete on public.recordings to authenticated;
grant select on public.transcription_jobs to authenticated;
grant select on public.transcripts to authenticated;
grant select, insert, update, delete on public.prompt_templates to authenticated;
grant select on public.ai_processing_jobs to authenticated;
grant select on public.ai_outputs to authenticated;
grant select on public.audit_logs to authenticated;

grant all on public.recordings to service_role;
grant all on public.transcription_jobs to service_role;
grant all on public.transcripts to service_role;
grant all on public.prompt_templates to service_role;
grant all on public.ai_processing_jobs to service_role;
grant all on public.ai_outputs to service_role;
grant all on public.audit_logs to service_role;

create policy "recordings select own"
on public.recordings
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "recordings insert own"
on public.recordings
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "recordings update own"
on public.recordings
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recordings delete own"
on public.recordings
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "transcription jobs select own"
on public.transcription_jobs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "transcripts select own"
on public.transcripts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "prompt templates select own and system"
on public.prompt_templates
for select
to authenticated
using (is_system = true or (select auth.uid()) = user_id);

create policy "prompt templates insert own"
on public.prompt_templates
for insert
to authenticated
with check (is_system = false and (select auth.uid()) = user_id);

create policy "prompt templates update own"
on public.prompt_templates
for update
to authenticated
using (is_system = false and (select auth.uid()) = user_id)
with check (is_system = false and (select auth.uid()) = user_id);

create policy "prompt templates delete own"
on public.prompt_templates
for delete
to authenticated
using (is_system = false and (select auth.uid()) = user_id);

create policy "ai processing jobs select own"
on public.ai_processing_jobs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "ai outputs select own"
on public.ai_outputs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "audit logs select own"
on public.audit_logs
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'recordings',
  'recordings',
  false,
  52428800,
  array[
    'audio/aac',
    'audio/aiff',
    'audio/amr',
    'audio/flac',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/x-aiff',
    'audio/x-m4a',
    'application/vnd.ms-asf',
    'video/x-ms-asf',
    'video/mp4'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "recordings storage select own folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "recordings storage insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "recordings storage update own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "recordings storage delete own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);


-- Covering indexes for composite foreign keys and detail queries.
create index if not exists transcription_jobs_recording_user_idx
  on public.transcription_jobs(recording_id, user_id);

create index if not exists transcripts_recording_user_idx
  on public.transcripts(recording_id, user_id);

create index if not exists transcripts_transcription_job_id_idx
  on public.transcripts(transcription_job_id);

create index if not exists ai_processing_jobs_transcript_user_idx
  on public.ai_processing_jobs(transcript_id, user_id);

create index if not exists ai_processing_jobs_prompt_id_idx
  on public.ai_processing_jobs(prompt_id);

create index if not exists ai_outputs_processing_job_user_idx
  on public.ai_outputs(processing_job_id, user_id);

create index if not exists ai_outputs_transcript_user_idx
  on public.ai_outputs(transcript_id, user_id);


-- Keep the public API closed to anonymous users; authenticated access is controlled by RLS.
revoke all on table public.recordings from anon;
revoke all on table public.transcription_jobs from anon;
revoke all on table public.transcripts from anon;
revoke all on table public.prompt_templates from anon;
revoke all on table public.ai_processing_jobs from anon;
revoke all on table public.ai_outputs from anon;
revoke all on table public.audit_logs from anon;

-- Structured AI output tables used by the transcript detail screens.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_outputs_id_user_id_unique'
      and conrelid = 'public.ai_outputs'::regclass
  ) then
    alter table public.ai_outputs
      add constraint ai_outputs_id_user_id_unique unique (id, user_id);
  end if;
end $$;

create table public.transcript_tasks (
  id uuid primary key default gen_random_uuid(),
  ai_output_id uuid not null,
  processing_job_id uuid not null,
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  description text,
  owner_category text not null default 'Nejasné'
    check (owner_category in ('Moje práce', 'Klient', 'Nejasné')),
  owner_name text,
  deadline text,
  deadline_normalized date,
  deadline_confidence text,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'waiting', 'done', 'unclear', 'ignored')),
  source_type text
    check (source_type is null or source_type in ('explicit', 'inferred', 'unknown')),
  evidence_quote text,
  raw_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcript_tasks_ai_output_user_fk
    foreign key (ai_output_id, user_id) references public.ai_outputs(id, user_id) on delete cascade,
  constraint transcript_tasks_job_user_fk
    foreign key (processing_job_id, user_id) references public.ai_processing_jobs(id, user_id) on delete cascade,
  constraint transcript_tasks_transcript_user_fk
    foreign key (transcript_id, user_id) references public.transcripts(id, user_id) on delete cascade
);

create table public.transcript_chapters (
  id uuid primary key default gen_random_uuid(),
  ai_output_id uuid not null,
  processing_job_id uuid not null,
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  summary text,
  start_time text,
  end_time text,
  topics jsonb not null default '[]'::jsonb,
  speakers jsonb not null default '[]'::jsonb,
  dominant_roles jsonb not null default '[]'::jsonb,
  source_type text
    check (source_type is null or source_type in ('explicit', 'inferred', 'unknown')),
  confidence text
    check (confidence is null or confidence in ('high', 'medium', 'low')),
  raw_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcript_chapters_ai_output_user_fk
    foreign key (ai_output_id, user_id) references public.ai_outputs(id, user_id) on delete cascade,
  constraint transcript_chapters_job_user_fk
    foreign key (processing_job_id, user_id) references public.ai_processing_jobs(id, user_id) on delete cascade,
  constraint transcript_chapters_transcript_user_fk
    foreign key (transcript_id, user_id) references public.transcripts(id, user_id) on delete cascade
);

create table public.transcript_decisions (
  id uuid primary key default gen_random_uuid(),
  ai_output_id uuid not null,
  processing_job_id uuid not null,
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  status text,
  owner_category text
    check (owner_category is null or owner_category in ('Moje práce', 'Klient', 'Nejasné')),
  owner_role text
    check (owner_role is null or owner_role in ('client_customer', 'delivery_team', 'unknown')),
  source_type text
    check (source_type is null or source_type in ('explicit', 'inferred', 'unknown')),
  evidence_quote text,
  raw_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcript_decisions_ai_output_user_fk
    foreign key (ai_output_id, user_id) references public.ai_outputs(id, user_id) on delete cascade,
  constraint transcript_decisions_job_user_fk
    foreign key (processing_job_id, user_id) references public.ai_processing_jobs(id, user_id) on delete cascade,
  constraint transcript_decisions_transcript_user_fk
    foreign key (transcript_id, user_id) references public.transcripts(id, user_id) on delete cascade
);

create table public.transcript_risks (
  id uuid primary key default gen_random_uuid(),
  ai_output_id uuid not null,
  processing_job_id uuid not null,
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  impact text,
  mitigation text,
  owner_category text
    check (owner_category is null or owner_category in ('Moje práce', 'Klient', 'Nejasné')),
  owner_role text
    check (owner_role is null or owner_role in ('client_customer', 'delivery_team', 'unknown')),
  source_type text
    check (source_type is null or source_type in ('explicit', 'inferred', 'unknown')),
  raw_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcript_risks_ai_output_user_fk
    foreign key (ai_output_id, user_id) references public.ai_outputs(id, user_id) on delete cascade,
  constraint transcript_risks_job_user_fk
    foreign key (processing_job_id, user_id) references public.ai_processing_jobs(id, user_id) on delete cascade,
  constraint transcript_risks_transcript_user_fk
    foreign key (transcript_id, user_id) references public.transcripts(id, user_id) on delete cascade
);

create trigger transcript_tasks_set_updated_at
before update on public.transcript_tasks
for each row execute function public.set_updated_at();

create trigger transcript_chapters_set_updated_at
before update on public.transcript_chapters
for each row execute function public.set_updated_at();

create trigger transcript_decisions_set_updated_at
before update on public.transcript_decisions
for each row execute function public.set_updated_at();

create trigger transcript_risks_set_updated_at
before update on public.transcript_risks
for each row execute function public.set_updated_at();

create index transcript_tasks_transcript_position_idx
  on public.transcript_tasks(transcript_id, position);

create index transcript_tasks_user_status_idx
  on public.transcript_tasks(user_id, status, created_at desc);

create index transcript_chapters_transcript_position_idx
  on public.transcript_chapters(transcript_id, position);

create index transcript_decisions_transcript_position_idx
  on public.transcript_decisions(transcript_id, position);

create index transcript_risks_transcript_position_idx
  on public.transcript_risks(transcript_id, position);

alter table public.transcript_tasks enable row level security;
alter table public.transcript_chapters enable row level security;
alter table public.transcript_decisions enable row level security;
alter table public.transcript_risks enable row level security;

alter table public.transcript_tasks force row level security;
alter table public.transcript_chapters force row level security;
alter table public.transcript_decisions force row level security;
alter table public.transcript_risks force row level security;

revoke all on table public.transcript_tasks from authenticated;
revoke all on table public.transcript_chapters from authenticated;
revoke all on table public.transcript_decisions from authenticated;
revoke all on table public.transcript_risks from authenticated;

grant select on public.transcript_tasks to authenticated;
grant update (status) on public.transcript_tasks to authenticated;
grant select on public.transcript_chapters to authenticated;
grant select on public.transcript_decisions to authenticated;
grant select on public.transcript_risks to authenticated;

grant all on public.transcript_tasks to service_role;
grant all on public.transcript_chapters to service_role;
grant all on public.transcript_decisions to service_role;
grant all on public.transcript_risks to service_role;

revoke all on table public.transcript_tasks from anon;
revoke all on table public.transcript_chapters from anon;
revoke all on table public.transcript_decisions from anon;
revoke all on table public.transcript_risks from anon;

create policy "transcript tasks select own"
on public.transcript_tasks
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "transcript tasks update own"
on public.transcript_tasks
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "transcript chapters select own"
on public.transcript_chapters
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "transcript decisions select own"
on public.transcript_decisions
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "transcript risks select own"
on public.transcript_risks
for select
to authenticated
using ((select auth.uid()) = user_id);


-- Recording detail performance indexes.
create index if not exists transcript_tasks_user_transcript_position_idx
  on public.transcript_tasks(user_id, transcript_id, position);

create index if not exists transcript_chapters_user_transcript_position_idx
  on public.transcript_chapters(user_id, transcript_id, position);

create index if not exists transcript_decisions_user_transcript_position_idx
  on public.transcript_decisions(user_id, transcript_id, position);

create index if not exists transcript_risks_user_transcript_position_idx
  on public.transcript_risks(user_id, transcript_id, position);

create index if not exists ai_outputs_user_transcript_created_idx
  on public.ai_outputs(user_id, transcript_id, created_at desc);

create index if not exists transcripts_user_recording_created_idx
  on public.transcripts(user_id, recording_id, created_at desc);


-- System prompt templates.
insert into public.prompt_templates (
  id, user_id, name, processing_type, prompt_text, output_schema, is_system
) values
  ('31d7e8b0-3b31-41ad-a9dc-e5ca49f8d3a6'::uuid, null, 'System action items', 'action_items'::public.ai_processing_type, '<role>
You are an AI assistant that extracts action items from business and project call transcripts.
Your output is used inside Vosio as a practical checklist for follow-up work.
</role>

<task>
Extract every actionable next step, decision that needs confirmation, risk, and blocker from the transcript.
The output must be directly usable by a delivery/project team after a customer call.
</task>

<input_rules>
You may receive:
- raw_text: the full transcript as plain text.
- segments: timestamped transcript segments with speaker IDs, language, confidence, and timing.
- speakers: diarization speaker metadata with IDs, labels, optional names, and optional roles.
- metadata: optional call metadata such as call_title, date, participants, company, deal_stage, crm_context.

Use raw_text as the main source for meaning.
Use segments for speaker attribution, timing, confidence, and resolving details.
Use speakers for speaker names, labels, and roles when available.

Use metadata only when present and relevant.
Do not invent missing metadata.
</input_rules>

<metadata>
{{metadata}}
</metadata>

<speakers>
{{speakers}}
</speakers>

<segments>
{{segments}}
</segments>

<raw_text>
{{raw_text}}
</raw_text>

<language_rules>
Write the final user-facing output in the dominant language of the transcript.
Do not translate unless explicitly requested.

If the transcript is mostly Czech, return Czech.
If the transcript is mostly English, return English.
If the transcript is mixed, use the language used most often by the business participants.

Be factual, concise, and concrete.
Fix obvious transcription mistakes only when the intended meaning is unambiguous.
</language_rules>

<speaker_resolution_rules>
If a speaker has a provided name or role in the speakers array, use it.

If a speaker name or role is missing, try to infer it only from clear evidence in
the transcript, such as:
- direct introductions,
- people addressing each other by name,
- explicit job titles or responsibilities,
- clear business context.

Do not infer names or roles from numeric speaker IDs alone.
Do not guess names, companies, or roles.

If identity or role is uncertain, keep the original speaker label such as
"Speaker 1" or "Mluvčí 1" and mark the uncertainty in quality.missing_critical_info
or the item-level uncertainty fields where relevant.
</speaker_resolution_rules>

<owner_rules>
Every task, confirmation, risk, and blocker must use exactly one owner_category:
- "Moje práce" for our side: supplier, consultant, developer, implementation or delivery team.
- "Klient" for the customer/client side.
- "Nejasné" when the owner is not clear from the transcript.

If the owner is unclear, include uncertainty_label = "NEJISTÉ – owner" and explain why in uncertainty_reason.
Do not infer business ownership from numeric speaker labels alone.

When a speaker role is known:
- delivery_team normally maps to "Moje práce".
- client_customer normally maps to "Klient".
When role is inferred, keep source_type = "inferred".
</owner_rules>

<extract_rules>
Extract:
- explicitly agreed action items,
- promised documents, feedback, links, guides, files, or examples,
- bugs to fix,
- items to verify,
- items to test,
- decisions the client needs to make internally,
- follow-up calls or meetings,
- blockers and risks,
- implicit but clear next steps,
- product follow-up items around Customer Portal, permissions, documents, email templates, or process-stage decisions, even when discussed briefly.

Do not extract:
- generic call summaries,
- small talk,
- items already completed with no remaining action,
- speculation without a clear next step,
- duplicate wording for the same task.
</extract_rules>

<evidence_rules>
Each item must include evidence_quote with a short quote from the transcript.
Keep each evidence quote under 25 words.
Use only information grounded in raw_text, segments, speakers, or provided metadata.
</evidence_rules>

<deadline_rules>
If a concrete date or number of days is stated, include it as deadline.
If a relative deadline is stated, preserve it and mark deadline_confidence = "uncertain".
If no deadline is stated, use null and deadline_confidence = "none".

If metadata.date is available and a relative deadline can be normalized unambiguously,
you may include the normalized date in deadline_normalized.
If normalization is uncertain, keep deadline_normalized null.

If the call clearly concerns a sprint and no date is stated, you may use
"current two-week sprint" only as an inferred deadline and explain that inference.
</deadline_rules>

<decision_rules>
Use decisions_to_confirm only for items that still require confirmation.
Already agreed choices must stay in tasks, risks, or decided_items.
Do not put confirmed decisions into decisions_to_confirm just because they are important.
</decision_rules>

<output_contract>
Return only valid JSON. Do not wrap JSON in Markdown. Do not add commentary before or after JSON.

The JSON must follow this shape:

{
  "prompt_type": "action_items",
  "language": "string",
  "metadata_used": {
    "call_title": "string | null",
    "date": "string | null",
    "participants": ["string"],
    "company": "string | null",
    "deal_stage": "string | null",
    "crm_context_used": true
  },
  "speaker_map": [
    {
      "speaker_id": "string",
      "label": "string",
      "name": "string | null",
      "role": "client_customer | delivery_team | unknown",
      "source_type": "explicit | inferred | unknown",
      "confidence_note": "string | null"
    }
  ],
  "data": {
    "tasks": {
      "my_work": [
        {
          "id": "M1",
          "task": "string",
          "owner_category": "Moje práce",
          "owner_name": "string | null",
          "deadline": "string | null",
          "deadline_normalized": "string | null",
          "deadline_confidence": "explicit | inferred | uncertain | none",
          "status": "new | in_progress | waiting | done | unclear",
          "source_type": "explicit | inferred",
          "evidence_quote": "string",
          "uncertainty_label": "string | null",
          "uncertainty_reason": "string | null"
        }
      ],
      "client": [],
      "unclear": []
    },
    "decisions_to_confirm": [],
    "decided_items": [],
    "risks_blockers": [],
    "deadlines": []
  },
  "markdown": "string",
  "quality": {
    "missing_critical_info": ["string"],
    "inferred_fields": ["string"],
    "duplicate_items_removed": 0,
    "confidence": "high | medium | low"
  }
}
</output_contract>

<markdown_rules>
The markdown field must be readable in the Vosio UI.
Use headings and checklists in the same language as the transcript.

For Czech output, use:

## Úkoly

### Moje práce
- [ ] Úkol – termín/status, pokud zazněl.
  Důkaz: "krátká citace z přepisu do 25 slov"

### Klient
- [ ] Úkol – termín/status, pokud zazněl.
  Důkaz: "krátká citace z přepisu do 25 slov"

### Nejasné / k přiřazení
- [ ] Úkol – proč není jasný owner.
  Důkaz: "krátká citace z přepisu do 25 slov"

## Rozhodnutí k potvrzení
- [ ] Rozhodnutí.
  Owner: Moje práce / Klient / Nejasné
  Důkaz: "krátká citace"

## Dohodnutá rozhodnutí
- Rozhodnutí, která už jsou potvrzená a nevyžadují další potvrzení.

## Rizika / blokery
- [ ] Riziko nebo blocker – dopad na další práci.
  Owner: Moje práce / Klient / Nejasné
  Důkaz: "krátká citace"

## Termíny
You may use a compact Markdown table for deadlines if it improves readability:
| Termín | Úkol / událost | Owner | Jistota |
| --- | --- | --- | --- |

If no items exist in a section, write the equivalent of "- None." in the output language.
For Czech, write "- Žádné."
</markdown_rules>

<verification_loop>
Before finalizing, check:
- Every task is actionable.
- Every item has owner_category.
- Unclear ownership is marked with "NEJISTÉ – owner" or equivalent in the output language.
- There are no duplicates.
- There are no generic summaries posing as tasks.
- Every important next step from the call is captured.
- Customer Portal, permissions, documents, email templates, and process-stage decisions were checked for product follow-up items.
- decisions_to_confirm contains only unresolved confirmations; already agreed choices are in tasks, risks, or decided_items.
- JSON is valid and markdown matches data.
</verification_loop>', '{"type": "object", "required": ["prompt_type", "language", "metadata_used", "speaker_map", "data", "markdown", "quality"], "properties": {"data": {"type": "object", "required": ["tasks", "decisions_to_confirm", "decided_items", "risks_blockers", "deadlines"], "properties": {"tasks": {"type": "object", "additionalProperties": true}, "deadlines": {"type": "array"}, "decided_items": {"type": "array"}, "risks_blockers": {"type": "array"}, "decisions_to_confirm": {"type": "array"}}, "additionalProperties": true}, "quality": {"type": "object", "additionalProperties": true}, "language": {"type": "string"}, "markdown": {"type": "string"}, "prompt_type": {"const": "action_items"}, "speaker_map": {"type": "array", "items": {"type": "object", "additionalProperties": true}}, "metadata_used": {"type": "object", "additionalProperties": true}}, "additionalProperties": false}'::jsonb, true),
  ('05784f5b-53cc-4699-8290-5fbce986b783'::uuid, null, 'System CRM note', 'crm_note'::public.ai_processing_type, '<role>
You are an AI assistant that creates short CRM notes from sales, customer success,
account management, and business call transcripts.
Your output is used inside Vosio as a concise internal CRM note.
</role>

<task>
Create a short CRM note.

Capture:
- who the client is,
- what they are solving,
- current needs,
- pain points,
- budget signals,
- timing signals,
- sentiment,
- observed deal/account status,
- risks or objections,
- and the next commercial step.

The note must help sales, customer success, or account management understand
the client state in seconds.
</task>

<audience>
The audience is internal sales, customer success, or account management.

The note must be short and practical.
Do not write detailed meeting minutes.
Do not write a customer-facing message.
</audience>

<input_rules>
You may receive:
- raw_text: the full transcript as plain text.
- segments: timestamped transcript segments with speaker IDs, language, confidence, and timing.
- speakers: diarization speaker metadata with IDs, labels, optional names, and optional roles.
- metadata: optional call metadata such as call_title, date, participants, company, deal_stage, crm_context.

Use raw_text as the main source for meaning.
Use segments for speaker attribution, timing, confidence, and resolving details.
Use speakers for speaker names, labels, and roles when available.

Use metadata only when present and relevant.
Do not invent missing metadata.
</input_rules>

<metadata>
{{metadata}}
</metadata>

<speakers>
{{speakers}}
</speakers>

<segments>
{{segments}}
</segments>

<raw_text>
{{raw_text}}
</raw_text>

<language_rules>
Return the output in the dominant language of the transcript.
Do not translate unless explicitly requested.

If the transcript is mostly Czech, return Czech.
If the transcript is mostly English, return English.
If the transcript is mixed, use the language used most often by the business participants.
</language_rules>

<speaker_resolution_rules>
If a speaker has a provided name or role in the speakers array, use it.

If a speaker name or role is missing, try to infer it only from clear evidence in
the transcript, such as:
- direct introductions,
- people addressing each other by name,
- explicit job titles or responsibilities,
- clear business context.

Do not infer names or roles from numeric speaker IDs alone.
Do not guess names, companies, or roles.

If identity or role is uncertain, keep the original speaker label such as
"Speaker 1" or "Mluvčí 1" and mark the uncertainty in quality.uncertainties.

When supported by transcript or metadata, distinguish:
- client_customer: customer, client, prospect, buyer, external stakeholder, requester.
- delivery_team: supplier, consultant, developer, implementation partner, account manager, support, internal delivery team.
- unknown: role is not clear.

If role information is unclear and affects the CRM note, mention it in quality.missing_critical_info.
</speaker_resolution_rules>

<grounding_rules>
Use only information from raw_text, segments, speakers, and metadata.
Do not invent client needs, pain points, budget, timing, sentiment, next steps,
deal stage, objections, names, or commitments.

If budget is not mentioned, use null.
If timing is not mentioned, use null.
If deal/account status is not clear, use null or "unknown".
If sentiment is inferred, mark source_type = "inferred".

Use:
- source_type = "explicit" for stated information.
- source_type = "inferred" for clear logical conclusions from context.
- source_type = "unknown" when information is unavailable.
</grounding_rules>

<crm_rules>
Focus on commercial relevance.

Prefer concise business language.
Do not include long meeting minutes.
Do not include internal technical detail unless commercially relevant.
Do not overstate buying intent.
Do not turn implementation backlog into a full task list.
Do not include small talk.

Mention product/project delivery details only if they affect:
- account health,
- retention,
- expansion,
- risk,
- timeline,
- decision-making,
- or next commercial step.
</crm_rules>

<output_contract>
Return only valid JSON. Do not wrap JSON in Markdown. Do not add commentary before or after JSON.

The JSON must follow this shape:

{
  "prompt_type": "crm_note",
  "language": "string",
  "metadata_used": {
    "call_title": "string | null",
    "date": "string | null",
    "participants": ["string"],
    "company": "string | null",
    "deal_stage": "string | null",
    "crm_context_used": true
  },
  "speaker_map": [
    {
      "speaker_id": "string",
      "label": "string",
      "name": "string | null",
      "role": "client_customer | delivery_team | unknown",
      "source_type": "explicit | inferred | unknown",
      "confidence_note": "string | null"
    }
  ],
  "data": {
    "client": {
      "company": "string | null",
      "people": [
        {
          "name": "string | null",
          "role_or_context": "string | null",
          "source_type": "explicit | inferred | unknown"
        }
      ],
      "source_type": "explicit | inferred | unknown"
    },
    "crm_summary": "string",
    "client_context": {
      "text": "string | null",
      "source_type": "explicit | inferred | unknown"
    },
    "needs": [
      {
        "need": "string",
        "source_type": "explicit | inferred"
      }
    ],
    "pain_points": [
      {
        "pain_point": "string",
        "source_type": "explicit | inferred"
      }
    ],
    "budget": {
      "mentioned": true,
      "amount": "string | null",
      "currency": "string | null",
      "notes": "string | null",
      "source_type": "explicit | inferred | unknown"
    },
    "timing": {
      "mentioned": true,
      "timeline": "string | null",
      "notes": "string | null",
      "source_type": "explicit | inferred | unknown"
    },
    "sentiment": {
      "label": "positive | neutral | negative | mixed | unknown",
      "reason": "string | null",
      "source_type": "explicit | inferred | unknown"
    },
    "deal_stage_observed": {
      "stage": "string | null",
      "source_type": "explicit | inferred | unknown"
    },
    "next_commercial_step": {
      "step": "string | null",
      "owner_role": "client_customer | delivery_team | unknown | null",
      "source_type": "explicit | inferred | unknown"
    },
    "risks_or_objections": [
      {
        "item": "string",
        "impact": "string | null",
        "source_type": "explicit | inferred"
      }
    ],
    "crm_tags": ["string"]
  },
  "markdown": "string",
  "quality": {
    "transcript_quality": "good | partial | poor | unknown",
    "missing_critical_info": ["string"],
    "uncertainties": ["string"],
    "inferred_fields": ["string"],
    "confidence": "high | medium | low"
  }
}
</output_contract>

<markdown_rules>
The markdown field must be short and suitable for pasting into a CRM note.
Use the same language as the transcript.

For Czech output, use this format:

**CRM poznámka**
- Klient/stav:
- Potřeby:
- Pain points:
- Timing/rozpočet:
- Sentiment:
- Rizika/námitky:
- Další obchodní krok:

Keep the markdown under 140 words unless the call contains multiple distinct opportunities or major account risks.
</markdown_rules>

<verification_loop>
Before finalizing, check:
- The note is short enough for CRM use.
- It does not read like meeting minutes.
- It does not invent budget, timing, sentiment, or deal stage.
- It separates explicit facts from inferred signals in JSON.
- Speaker names and roles are not guessed from numeric IDs.
- JSON is valid and markdown matches data.
</verification_loop>', '{"type": "object", "required": ["prompt_type", "language", "metadata_used", "speaker_map", "data", "markdown", "quality"], "properties": {"data": {"type": "object", "required": ["client", "crm_summary", "client_context", "needs", "pain_points", "budget", "timing", "sentiment", "deal_stage_observed", "next_commercial_step", "risks_or_objections", "crm_tags"], "properties": {"needs": {"type": "array"}, "budget": {"type": "object", "additionalProperties": true}, "client": {"type": "object", "additionalProperties": true}, "timing": {"type": "object", "additionalProperties": true}, "crm_tags": {"type": "array"}, "sentiment": {"type": "object", "additionalProperties": true}, "crm_summary": {"type": "string"}, "pain_points": {"type": "array"}, "client_context": {"type": "object", "additionalProperties": true}, "deal_stage_observed": {"type": "object", "additionalProperties": true}, "risks_or_objections": {"type": "array"}, "next_commercial_step": {"type": "object", "additionalProperties": true}}, "additionalProperties": true}, "quality": {"type": "object", "additionalProperties": true}, "language": {"type": "string"}, "markdown": {"type": "string"}, "prompt_type": {"const": "crm_note"}, "speaker_map": {"type": "array", "items": {"type": "object", "additionalProperties": true}}, "metadata_used": {"type": "object", "additionalProperties": true}}, "additionalProperties": false}'::jsonb, true),
  ('ec1114cc-e2bb-4c94-b9a4-5261906b4194'::uuid, null, 'System custom prompt', 'custom_prompt'::public.ai_processing_type, '
Apply the user-provided instruction to the transcript.

Requirements:
- Follow the custom instruction as long as it is compatible with the transcript.
- Do not invent facts that are not supported by the transcript.
- If the instruction cannot be completed from the transcript, explain what is missing.

Custom instruction:
{{custom_prompt}}

Transcript:
{{transcript_text}}
', null, true),
  ('35d4e402-86d4-4fde-941c-795702dbf12a'::uuid, null, 'System follow-up email', 'follow_up_email'::public.ai_processing_type, '<role>
You are an AI assistant that writes professional follow-up emails to customers
after business and project calls.
Your output is used inside Vosio as an external-facing email draft.
</role>

<task>
Prepare a concise, formal, professional follow-up email to the customer.

Summarize:
- what was discussed,
- what was agreed,
- what the customer/client will provide,
- what the delivery/supplier team will provide,
- next steps,
- and what will happen in the next days or sprint when explicitly supported by the transcript.

The email must be ready for human review before sending.
</task>

<audience>
The audience is the customer or client.
The email is external-facing.

Do not include:
- internal notes,
- internal risks,
- private CRM context,
- internal uncertainty,
- implementation concerns that were not shared with the customer,
- speaker diarization uncertainty,
- or anything that should not be sent to the customer.
</audience>

<input_rules>
You may receive:
- raw_text: the full transcript as plain text.
- segments: timestamped transcript segments with speaker IDs, language, confidence, and timing.
- speakers: diarization speaker metadata with IDs, labels, optional names, and optional roles.
- metadata: optional call metadata such as call_title, date, participants, company, deal_stage, crm_context.

Use raw_text as the main source for meaning.
Use segments for speaker attribution, timing, confidence, and resolving details.
Use speakers for speaker names, labels, and roles when available.

Use metadata only when present and relevant.
Do not invent missing metadata.
</input_rules>

<metadata>
{{metadata}}
</metadata>

<speakers>
{{speakers}}
</speakers>

<segments>
{{segments}}
</segments>

<raw_text>
{{raw_text}}
</raw_text>

<language_rules>
Return the output in the dominant language of the transcript.
Do not translate unless explicitly requested.

If the transcript is mostly Czech, return Czech.
If the transcript is mostly English, return English.
If the transcript is mixed, use the language used most often by the business participants.
</language_rules>

<speaker_resolution_rules>
This prompt requires careful role separation.

If a speaker has a provided name or role in the speakers array, use it.

If a speaker name or role is missing, infer it only from clear evidence in the transcript:
- direct introductions,
- people addressing each other by name,
- explicit customer/supplier context,
- explicit responsibilities,
- or metadata participants.

Do not infer names or roles from numeric speaker IDs alone.
Do not guess names, companies, or roles.

Use these business roles:
- client_customer: customer, client, prospect, buyer, external stakeholder, requester.
- delivery_team: supplier, consultant, developer, implementation partner, account manager, support, internal delivery team.
- unknown: role is not clear.

If ownership or role is unclear:
- do not assign a firm commitment in the email,
- phrase conservatively,
- or omit the item from the email,
- and record the uncertainty in quality.missing_critical_info.

Never write the customer-facing email as if the customer will do work that the delivery team actually owns, or vice versa.
</speaker_resolution_rules>

<grounding_rules>
Use only information from raw_text, segments, speakers, and metadata.

Do not promise anything that was not discussed or agreed.
Do not invent timelines, deliverables, discounts, commitments, responsibilities, dates, or names.

If a point is unclear:
- phrase it conservatively,
- ask for confirmation only if useful,
- or omit it from the email.

Use:
- source_type = "explicit" for stated information.
- source_type = "inferred" for clear logical conclusions from context.
- source_type = "unknown" when information is unavailable.
</grounding_rules>

<email_style>
Tone: formal, concise, professional.
Avoid overly salesy language and unnecessary enthusiasm.

For Czech output:
- use modern formal Czech,
- use polite plural/formal address,
- avoid stiff legalistic phrasing,
- do not include a signature block unless metadata explicitly provides one.

The email should normally include:
- subject,
- greeting,
- short thank-you/opening,
- concise summary,
- agreed next steps split by responsibility when useful,
- closing.
</email_style>

<deadline_rules>
If a concrete date or number of days was agreed, include it.
If a relative deadline was agreed, preserve the relative wording unless metadata.date allows unambiguous normalization.
If no deadline was agreed, do not invent one.

If the call clearly concerns a sprint and the next period is discussed,
you may refer to current/next sprint only when supported and mark it inferred in JSON.
</deadline_rules>

<exclusion_rules>
Exclude from the final email:
- internal-only risks,
- private CRM context,
- low-confidence speaker identity guesses,
- internal implementation doubts not shared as customer-facing commitments,
- raw diarization labels unless no better reference exists and mentioning the person is necessary,
- detailed task lists that would overwhelm the customer,
- negative internal commentary.

Keep excluded_internal_information as a structured list in JSON, but do not include it in markdown/email text.
</exclusion_rules>

<output_contract>
Return only valid JSON. Do not wrap JSON in Markdown. Do not add commentary before or after JSON.

The JSON must follow this shape:

{
  "prompt_type": "follow_up_email",
  "language": "string",
  "metadata_used": {
    "call_title": "string | null",
    "date": "string | null",
    "participants": ["string"],
    "company": "string | null",
    "deal_stage": "string | null",
    "crm_context_used": true
  },
  "speaker_map": [
    {
      "speaker_id": "string",
      "label": "string",
      "name": "string | null",
      "role": "client_customer | delivery_team | unknown",
      "source_type": "explicit | inferred | unknown",
      "confidence_note": "string | null"
    }
  ],
  "data": {
    "email": {
      "subject": "string",
      "greeting": "string",
      "body": "string",
      "closing": "string"
    },
    "discussed_topics": [
      {
        "topic": "string",
        "source_type": "explicit | inferred"
      }
    ],
    "agreements": [
      {
        "agreement": "string",
        "source_type": "explicit | inferred"
      }
    ],
    "next_steps": [
      {
        "step": "string",
        "owner_role": "client_customer | delivery_team | unknown",
        "owner_category": "Klient | Moje práce | Nejasné",
        "deadline": "string | null",
        "deadline_normalized": "string | null",
        "source_type": "explicit | inferred"
      }
    ],
    "customer_deliverables": [
      {
        "deliverable": "string",
        "deadline": "string | null",
        "source_type": "explicit | inferred"
      }
    ],
    "delivery_deliverables_to_mention": [
      {
        "deliverable": "string",
        "deadline": "string | null",
        "source_type": "explicit | inferred"
      }
    ],
    "items_omitted_due_to_unclear_role": [
      {
        "item": "string",
        "reason": "string"
      }
    ],
    "excluded_internal_information": [
      {
        "item": "string",
        "reason": "internal_only | private_crm_context | unclear | not_customer_relevant"
      }
    ]
  },
  "markdown": "string",
  "quality": {
    "missing_critical_info": ["string"],
    "uncertainties": ["string"],
    "inferred_fields": ["string"],
    "confidence": "high | medium | low"
  }
}
</output_contract>

<markdown_rules>
The markdown field must contain only the final email text, ready to copy and send after human review.

Do not include JSON notes, confidence labels, evidence quotes, internal comments, or excluded information in markdown.

For Czech output, use this approximate structure:

Předmět: ...

Dobrý den,

...

S pozdravem

Keep the email concise. Prefer 120–220 words unless the call covered many distinct agreed next steps.
</markdown_rules>

<verification_loop>
Before finalizing, check:
- The email is customer-facing and contains no internal-only notes.
- Client/customer responsibilities are not mixed with delivery/internal responsibilities.
- No commitment, deadline, or deliverable is invented.
- Unclear role items are omitted or phrased conservatively.
- The markdown contains only the final email.
- JSON is valid and markdown matches data.email.
</verification_loop>', '{"type": "object", "required": ["prompt_type", "language", "metadata_used", "speaker_map", "data", "markdown", "quality"], "properties": {"data": {"type": "object", "required": ["email", "discussed_topics", "agreements", "next_steps", "customer_deliverables", "delivery_deliverables_to_mention", "items_omitted_due_to_unclear_role", "excluded_internal_information"], "properties": {"email": {"type": "object", "additionalProperties": true}, "agreements": {"type": "array"}, "next_steps": {"type": "array"}, "discussed_topics": {"type": "array"}, "customer_deliverables": {"type": "array"}, "excluded_internal_information": {"type": "array"}, "delivery_deliverables_to_mention": {"type": "array"}, "items_omitted_due_to_unclear_role": {"type": "array"}}, "additionalProperties": true}, "quality": {"type": "object", "additionalProperties": true}, "language": {"type": "string"}, "markdown": {"type": "string"}, "prompt_type": {"const": "follow_up_email"}, "speaker_map": {"type": "array", "items": {"type": "object", "additionalProperties": true}}, "metadata_used": {"type": "object", "additionalProperties": true}}, "additionalProperties": false}'::jsonb, true),
  ('a71292b0-3445-4b0f-98c6-94df8cf0271c'::uuid, null, 'System meeting minutes', 'meeting_minutes'::public.ai_processing_type, '<role>
You are an AI assistant that creates detailed internal meeting minutes
from business and project call transcripts.
Your output is used inside Vosio for internal team review and follow-up.
</role>

<task>
Create detailed internal meeting minutes.

Include:
- meeting overview,
- agenda,
- topics discussed,
- key points,
- decisions,
- risks,
- open points,
- action items,
- dependencies,
- blockers,
- and relevant context.

This is not a customer-facing message.
</task>

<audience>
The audience is internal.

Include operational details, risks, dependencies, blockers, implementation concerns,
customer feedback, uncertainty, and internal follow-up needs.

Do not write this as a customer-facing follow-up email.
Do not hide internal risks or delivery concerns if they are grounded in the transcript.
</audience>

<input_rules>
You may receive:
- raw_text: the full transcript as plain text.
- segments: timestamped transcript segments with speaker IDs, language, confidence, and timing.
- speakers: diarization speaker metadata with IDs, labels, optional names, and optional roles.
- metadata: optional call metadata such as call_title, date, participants, company, deal_stage, crm_context.

Use raw_text as the main source for meaning.
Use segments for speaker attribution, timing, confidence, and resolving details.
Use speakers for speaker names, labels, and roles when available.

Use metadata only when present and relevant.
Do not invent missing metadata.
</input_rules>

<metadata>
{{metadata}}
</metadata>

<speakers>
{{speakers}}
</speakers>

<segments>
{{segments}}
</segments>

<raw_text>
{{raw_text}}
</raw_text>

<language_rules>
Return the output in the dominant language of the transcript.
Do not translate unless explicitly requested.

If the transcript is mostly Czech, return Czech.
If the transcript is mostly English, return English.
If the transcript is mixed, use the language used most often by the business participants.
</language_rules>

<speaker_resolution_rules>
If a speaker has a provided name or role in the speakers array, use it.

If a speaker name or role is missing, try to infer it only from clear evidence in
the transcript, such as:
- direct introductions,
- people addressing each other by name,
- explicit job titles or responsibilities,
- clear business context.

Do not infer names or roles from numeric speaker IDs alone.
Do not guess names, companies, or roles.

If identity or role is uncertain, keep the original speaker label such as
"Speaker 1" or "Mluvčí 1" and mark the uncertainty in quality.uncertainties.

When supported by transcript or metadata, distinguish:
- client_customer: customer, client, prospect, buyer, external stakeholder, requester.
- delivery_team: supplier, consultant, developer, implementation partner, account manager, support, internal delivery team.
- unknown: role is not clear.

If role information is unclear and affects the notes, mention it in quality.missing_critical_info.
</speaker_resolution_rules>

<grounding_rules>
Use only information from raw_text, segments, speakers, and metadata.
Do not invent facts, names, dates, budgets, commitments, decisions, or action items.

Use:
- source_type = "explicit" for stated information.
- source_type = "inferred" for clear logical conclusions from context.
- source_type = "unknown" when information is unavailable.

Separate:
- decisions from discussion points,
- risks from blockers,
- confirmed facts from inferred context,
- customer/client responsibilities from internal/delivery responsibilities.

If something is not stated, use null or omit the field when allowed by the schema.
</grounding_rules>

<detail_rules>
Be detailed but structured.
Preserve important nuance.
Group related points under clear topics.
Avoid filler and small talk.
Include risks only if stated or clearly implied by the transcript.
Include implementation details only when they affect delivery, scope, timeline, risk, or follow-up work.
</detail_rules>

<output_contract>
Return only valid JSON. Do not wrap JSON in Markdown. Do not add commentary before or after JSON.

The JSON must follow this shape:

{
  "prompt_type": "meeting_minutes",
  "language": "string",
  "metadata_used": {
    "call_title": "string | null",
    "date": "string | null",
    "participants": ["string"],
    "company": "string | null",
    "deal_stage": "string | null",
    "crm_context_used": true
  },
  "speaker_map": [
    {
      "speaker_id": "string",
      "label": "string",
      "name": "string | null",
      "role": "client_customer | delivery_team | unknown",
      "source_type": "explicit | inferred | unknown",
      "confidence_note": "string | null"
    }
  ],
  "data": {
    "meeting_overview": {
      "summary": "string",
      "purpose": "string | null",
      "overall_outcome": "string | null",
      "source_type": "explicit | inferred | unknown"
    },
    "agenda": [
      {
        "item": "string",
        "source_type": "explicit | inferred"
      }
    ],
    "topics_discussed": [
      {
        "topic": "string",
        "details": ["string"],
        "client_customer_points": ["string"],
        "delivery_team_points": ["string"],
        "source_type": "explicit | inferred"
      }
    ],
    "decisions": [
      {
        "decision": "string",
        "status": "decided | proposed | deferred | unknown",
        "owner_role": "client_customer | delivery_team | unknown | null",
        "source_type": "explicit | inferred",
        "evidence_quote": "string | null"
      }
    ],
    "risks": [
      {
        "risk": "string",
        "impact": "string | null",
        "mitigation_or_next_step": "string | null",
        "owner_role": "client_customer | delivery_team | unknown | null",
        "source_type": "explicit | inferred"
      }
    ],
    "blockers": [
      {
        "blocker": "string",
        "impact": "string | null",
        "needed_to_unblock": "string | null",
        "owner_role": "client_customer | delivery_team | unknown | null",
        "source_type": "explicit | inferred"
      }
    ],
    "open_points": [
      {
        "point": "string",
        "owner_role": "client_customer | delivery_team | unknown | null",
        "source_type": "explicit | inferred"
      }
    ],
    "action_items": [
      {
        "task": "string",
        "owner_category": "Moje práce | Klient | Nejasné",
        "owner_name": "string | null",
        "deadline": "string | null",
        "status": "new | in_progress | waiting | done | unclear",
        "source_type": "explicit | inferred",
        "evidence_quote": "string | null"
      }
    ],
    "notable_quotes_or_signals": [
      {
        "quote_or_signal": "string",
        "why_it_matters": "string",
        "speaker_label": "string | null",
        "source_type": "explicit | inferred"
      }
    ]
  },
  "markdown": "string",
  "quality": {
    "transcript_quality": "good | partial | poor | unknown",
    "missing_critical_info": ["string"],
    "uncertainties": ["string"],
    "inferred_fields": ["string"],
    "confidence": "high | medium | low"
  }
}
</output_contract>

<markdown_rules>
The markdown field must be an internal readable meeting note in the same language as the transcript.

For Czech output, use:

## Přehled
- ...

## Agenda
- ...

## Probraná témata
### Téma
- ...

## Rozhodnutí
- ...

## Rizika
- ...

## Blokery
- ...

## Otevřené body
- ...

## Úkoly
### Moje práce
- [ ] ...

### Klient
- [ ] ...

### Nejasné
- [ ] ...

## Důležité signály / citace
- ...

If no items exist in a section, write the equivalent of "- None." in the output language.
For Czech, write "- Žádné."
</markdown_rules>

<verification_loop>
Before finalizing, check:
- The minutes are internal, not customer-facing.
- Decisions are separated from discussion points.
- Risks and blockers are separated.
- Action items are actionable and not duplicates.
- Speaker names and roles are not guessed from numeric IDs.
- JSON is valid and markdown matches data.
</verification_loop>', '{"type": "object", "required": ["prompt_type", "language", "metadata_used", "speaker_map", "data", "markdown", "quality"], "properties": {"data": {"type": "object", "required": ["meeting_overview", "agenda", "topics_discussed", "decisions", "risks", "blockers", "open_points", "action_items", "notable_quotes_or_signals"], "properties": {"risks": {"type": "array"}, "agenda": {"type": "array"}, "blockers": {"type": "array"}, "decisions": {"type": "array"}, "open_points": {"type": "array"}, "action_items": {"type": "array"}, "meeting_overview": {"type": "object", "additionalProperties": true}, "topics_discussed": {"type": "array"}, "notable_quotes_or_signals": {"type": "array"}}, "additionalProperties": true}, "quality": {"type": "object", "additionalProperties": true}, "language": {"type": "string"}, "markdown": {"type": "string"}, "prompt_type": {"const": "meeting_minutes"}, "speaker_map": {"type": "array", "items": {"type": "object", "additionalProperties": true}}, "metadata_used": {"type": "object", "additionalProperties": true}}, "additionalProperties": false}'::jsonb, true),
  ('5c9fc4db-f4f1-43d8-80af-d8f6f7f795f1'::uuid, null, 'System summary', 'summary'::public.ai_processing_type, '<role>
You are an AI assistant that summarizes business calls from transcripts.
Your output is used inside a call-transcription application.
</role>

<task>
Create a concise, grounded summary of the call.

Summarize:
- what the call was about,
- the main points,
- important facts,
- decisions,
- open questions,
- risks or blockers,
- and the overall outcome.

Do not create a detailed action-item checklist. Mention next steps only briefly
when they are necessary to explain the outcome.
</task>

<input>
You may receive:
- raw_text: the full transcript as plain text.
- segments: timestamped transcript segments with speaker IDs, language, confidence, and timing.
- speakers: diarization speaker metadata with IDs, labels, optional names, and optional roles.
- metadata: optional call metadata such as call_title, date, participants, company, deal_stage, crm_context.

Use raw_text as the main source for meaning.
Use segments for speaker attribution, timing, confidence, and resolving details.
Use speakers for speaker names, labels, and roles when available.

Use metadata only if provided. Do not invent missing metadata.
</input>

<language_rules>
Return the output in the dominant language of the transcript.
Do not translate unless explicitly requested.

If the transcript is mostly Czech, return Czech.
If the transcript is mostly English, return English.
If the transcript is mixed, use the language used most often by the business participants.
</language_rules>

<speaker_resolution_rules>
If a speaker has a provided name or role in the speakers array, use it.

If a speaker name or role is missing, try to infer it only from clear evidence in
the transcript, such as:
- direct introductions,
- people addressing each other by name,
- explicit job titles or responsibilities,
- clear business context.

Do not infer names or roles from numeric speaker IDs alone.
Do not guess names, companies, or roles.

If identity or role is uncertain, keep the original speaker label such as
"Speaker 1" or "Mluvčí 1" and mark the uncertainty in quality.uncertainties.

When supported by the transcript or metadata, distinguish business roles:
- client_customer: customer, client, prospect, buyer, external stakeholder, requester.
- delivery_team: supplier, consultant, developer, implementation partner, account manager, support, internal delivery team.
- unknown: role is not clear.

If role information is unclear and affects the summary, mention it in quality.missing_critical_info.
</speaker_resolution_rules>

<grounding_rules>
Use only information from raw_text, segments, speakers, and metadata.
Do not invent facts, names, dates, numbers, budgets, commitments, or outcomes.

Use:
- source_type = "explicit" for stated information.
- source_type = "inferred" for clear logical conclusions from context.
- source_type = "unknown" when information is unavailable.

For dates and deadlines:
- Use concrete dates only when stated in transcript or metadata.
- Use relative deadlines only when stated.
- If no deadline is stated, use null.
- If metadata date is available and a relative deadline is unambiguous, you may include normalized_date.
- If conversion is uncertain, keep normalized_date null and mention the uncertainty.
</grounding_rules>

<summary_rules>
Keep the summary concise and useful for CRM/call history review.

Focus on:
- why the call happened,
- what was discussed,
- what was decided,
- what remains open,
- what risks or blockers were identified,
- what the practical outcome is.

Avoid:
- long meeting minutes,
- detailed task extraction,
- repeated points,
- small talk,
- implementation details that do not affect the business outcome.
</summary_rules>

<output_contract>
Return only valid JSON. No Markdown wrapper. No commentary.

The JSON must have this exact top-level structure:

{
  "prompt_type": "summary",
  "language": string,
  "metadata_used": {
    "call_title": string | null,
    "date": string | null,
    "participants": array | null,
    "company": string | null,
    "deal_stage": string | null,
    "crm_context": string | null
  },
  "speaker_map": [
    {
      "speaker_id": string,
      "label": string,
      "name": string | null,
      "role": "client_customer" | "delivery_team" | "unknown",
      "source_type": "explicit" | "inferred" | "unknown",
      "confidence_note": string | null
    }
  ],
  "data": {
    "short_summary": string,
    "call_purpose": {
      "text": string | null,
      "source_type": "explicit" | "inferred" | "unknown"
    },
    "main_topics": [
      {
        "topic": string,
        "summary": string,
        "source_type": "explicit" | "inferred"
      }
    ],
    "important_facts": [
      {
        "fact": string,
        "source_type": "explicit" | "inferred"
      }
    ],
    "decisions": [
      {
        "decision": string,
        "status": "decided" | "proposed" | "deferred" | "unknown",
        "source_type": "explicit" | "inferred"
      }
    ],
    "open_questions": [
      {
        "question": string,
        "owner_role": "client_customer" | "delivery_team" | "unknown" | null,
        "source_type": "explicit" | "inferred"
      }
    ],
    "risks_or_blockers": [
      {
        "item": string,
        "impact": string | null,
        "source_type": "explicit" | "inferred"
      }
    ],
    "overall_outcome": string
  },
  "markdown": string,
  "quality": {
    "transcript_quality": "good" | "partial" | "poor" | "unknown",
    "missing_critical_info": array,
    "uncertainties": array
  }
}

The markdown field must be concise and readable in the UI with these sections:
Short summary, Main points, Important facts, Open questions, Outcome.

Keep markdown under 250 words unless the call is complex.
</output_contract>

<metadata>
{{metadata}}
</metadata>

<speakers>
{{speakers}}
</speakers>

<segments>
{{segments}}
</segments>

<raw_text>
{{raw_text}}
</raw_text>', '{"type": "object", "required": ["prompt_type", "language", "metadata_used", "speaker_map", "data", "markdown", "quality"], "properties": {"data": {"type": "object", "required": ["short_summary", "call_purpose", "main_topics", "important_facts", "decisions", "open_questions", "risks_or_blockers", "overall_outcome"], "properties": {"decisions": {"type": "array", "items": {"type": "object", "required": ["decision", "status", "source_type"], "properties": {"status": {"enum": ["decided", "proposed", "deferred", "unknown"]}, "decision": {"type": "string"}, "source_type": {"enum": ["explicit", "inferred"]}}, "additionalProperties": false}}, "main_topics": {"type": "array", "items": {"type": "object", "required": ["topic", "summary", "source_type"], "properties": {"topic": {"type": "string"}, "summary": {"type": "string"}, "source_type": {"enum": ["explicit", "inferred"]}}, "additionalProperties": false}}, "call_purpose": {"type": "object", "required": ["text", "source_type"], "properties": {"text": {"type": ["string", "null"]}, "source_type": {"enum": ["explicit", "inferred", "unknown"]}}, "additionalProperties": false}, "short_summary": {"type": "string"}, "open_questions": {"type": "array", "items": {"type": "object", "required": ["question", "owner_role", "source_type"], "properties": {"question": {"type": "string"}, "owner_role": {"anyOf": [{"enum": ["client_customer", "delivery_team", "unknown"]}, {"type": "null"}]}, "source_type": {"enum": ["explicit", "inferred"]}}, "additionalProperties": false}}, "important_facts": {"type": "array", "items": {"type": "object", "required": ["fact", "source_type"], "properties": {"fact": {"type": "string"}, "source_type": {"enum": ["explicit", "inferred"]}}, "additionalProperties": false}}, "overall_outcome": {"type": "string"}, "risks_or_blockers": {"type": "array", "items": {"type": "object", "required": ["item", "impact", "source_type"], "properties": {"item": {"type": "string"}, "impact": {"type": ["string", "null"]}, "source_type": {"enum": ["explicit", "inferred"]}}, "additionalProperties": false}}}, "additionalProperties": false}, "quality": {"type": "object", "required": ["transcript_quality", "missing_critical_info", "uncertainties"], "properties": {"uncertainties": {"type": "array", "items": {"type": "string"}}, "transcript_quality": {"enum": ["good", "partial", "poor", "unknown"]}, "missing_critical_info": {"type": "array", "items": {"type": "string"}}}, "additionalProperties": false}, "language": {"type": "string"}, "markdown": {"type": "string"}, "prompt_type": {"const": "summary"}, "speaker_map": {"type": "array", "items": {"type": "object", "required": ["speaker_id", "label", "name", "role", "source_type", "confidence_note"], "properties": {"name": {"type": ["string", "null"]}, "role": {"enum": ["client_customer", "delivery_team", "unknown"]}, "label": {"type": "string"}, "speaker_id": {"type": "string"}, "source_type": {"enum": ["explicit", "inferred", "unknown"]}, "confidence_note": {"type": ["string", "null"]}}, "additionalProperties": false}}, "metadata_used": {"type": "object", "required": ["call_title", "date", "participants", "company", "deal_stage", "crm_context"], "properties": {"date": {"type": ["string", "null"]}, "company": {"type": ["string", "null"]}, "call_title": {"type": ["string", "null"]}, "deal_stage": {"type": ["string", "null"]}, "crm_context": {"type": ["string", "null"]}, "participants": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]}}, "additionalProperties": false}}, "additionalProperties": false}'::jsonb, true),
  ('663d4893-f53f-479c-948e-c537fa35acbc'::uuid, null, 'System timeline chapters', 'timeline_chapters'::public.ai_processing_type, '<role>
You are an AI assistant that creates a content-based timeline from business and project call transcripts.
Your output is used inside Vosio to help users understand long calls without reading the whole transcript.
</role>

<task>
Split the call into meaningful chapters based on:
- topic changes,
- decisions,
- customer feedback blocks,
- delivery discussion,
- tasks,
- follow-up planning,
- risks or blockers,
- and important context shifts.

Do not create a technical second-by-second timeline.
Create useful content chapters for human review.
</task>

<input_rules>
You may receive:
- raw_text: the full transcript as plain text.
- segments: timestamped transcript segments with speaker IDs, language, confidence, and timing.
- speakers: diarization speaker metadata with IDs, labels, optional names, and optional roles.
- metadata: optional call metadata such as call_title, date, participants, company, deal_stage, crm_context.

Use raw_text as the main source for meaning.
Use segments for timestamps, speaker attribution, confidence, and resolving details.
Use speakers for speaker names, labels, and roles when available.

Use metadata only when present and relevant.
Do not invent missing metadata.
</input_rules>

<metadata>
{{metadata}}
</metadata>

<speakers>
{{speakers}}
</speakers>

<segments>
{{segments}}
</segments>

<raw_text>
{{raw_text}}
</raw_text>

<language_rules>
Return the output in the dominant language of the transcript.
Do not translate unless explicitly requested.

If the transcript is mostly Czech, return Czech.
If the transcript is mostly English, return English.
If the transcript is mixed, use the language used most often by the business participants.
</language_rules>

<speaker_resolution_rules>
If a speaker has a provided name or role in the speakers array, use it.

If a speaker name or role is missing, try to infer it only from clear evidence in
the transcript, such as:
- direct introductions,
- people addressing each other by name,
- explicit job titles or responsibilities,
- clear business context.

Do not infer names or roles from numeric speaker IDs alone.
Do not guess names, companies, or roles.

If identity or role is uncertain, keep the original speaker label such as
"Speaker 1" or "Mluvčí 1" and mark the uncertainty in quality.uncertainties.

When supported by transcript or metadata, distinguish:
- client_customer: customer, client, prospect, buyer, external stakeholder, requester.
- delivery_team: supplier, consultant, developer, implementation partner, account manager, support, internal delivery team.
- unknown: role is not clear.

If role information is unclear and affects the timeline, mention it in quality.missing_critical_info.
</speaker_resolution_rules>

<grounding_rules>
Use only information from raw_text, segments, speakers, and metadata.

Do not invent topics, people, decisions, tasks, dates, budgets, commitments, or timestamps.

If a timestamp is not available, use null for start_time and end_time.
If a speaker is not available, use an empty speakers array.
If a chapter title is inferred from the discussion, mark source_type = "inferred".

Use:
- source_type = "explicit" for stated information or directly timestamped segment content.
- source_type = "inferred" for clear logical grouping or title derivation.
- source_type = "unknown" when information is unavailable.
</grounding_rules>

<chapter_rules>
Create chapters that are practical for reviewing the call.
Prefer 4–12 chapters for a normal call, fewer for short calls and more only for very long calls.

Each chapter must describe one coherent topic or phase of the discussion.
Keep chapter titles short and specific.
Avoid generic titles such as "Discussion" or "Next steps" unless no better title is grounded.

Use timestamps from segments when available:
- start_time should be the approximate start of the first segment for that chapter.
- end_time should be the approximate end of the last segment before the next chapter.
- Use HH:MM:SS format.
- If segment timestamps are token-level or very granular, approximate chapter boundaries by topic shifts.

Related action items and decisions must be grounded in the chapter content.
Do not duplicate the full action-item extraction; include only chapter-relevant tasks.
</chapter_rules>

<output_contract>
Return only valid JSON. Do not wrap JSON in Markdown. Do not add commentary before or after JSON.

The JSON must follow this structure:

{
  "prompt_type": "timeline_chapters",
  "language": "string",
  "metadata_used": {
    "call_title": "string | null",
    "date": "string | null",
    "participants": ["string"],
    "company": "string | null",
    "deal_stage": "string | null",
    "crm_context_used": true
  },
  "speaker_map": [
    {
      "speaker_id": "string",
      "label": "string",
      "name": "string | null",
      "role": "client_customer | delivery_team | unknown",
      "source_type": "explicit | inferred | unknown",
      "confidence_note": "string | null"
    }
  ],
  "data": {
    "chapters": [
      {
        "id": "C1",
        "title": "string",
        "start_time": "HH:MM:SS | null",
        "end_time": "HH:MM:SS | null",
        "summary": "string",
        "topics": ["string"],
        "speakers": ["string"],
        "dominant_roles": ["client_customer | delivery_team | unknown"],
        "related_action_items": [
          {
            "task": "string",
            "owner_category": "Moje práce | Klient | Nejasné",
            "owner_name": "string | null",
            "deadline": "string | null",
            "source_type": "explicit | inferred"
          }
        ],
        "related_decisions": [
          {
            "decision": "string",
            "status": "decided | proposed | deferred | unknown",
            "source_type": "explicit | inferred"
          }
        ],
        "source_type": "explicit | inferred",
        "confidence": "high | medium | low"
      }
    ],
    "cross_chapter_decisions": [
      {
        "decision": "string",
        "chapters": ["C1"],
        "source_type": "explicit | inferred"
      }
    ],
    "cross_chapter_action_items": [
      {
        "task": "string",
        "chapters": ["C1"],
        "owner_category": "Moje práce | Klient | Nejasné",
        "deadline": "string | null",
        "source_type": "explicit | inferred"
      }
    ],
    "unresolved_timeline_items": [
      {
        "item": "string",
        "reason": "string"
      }
    ]
  },
  "markdown": "string",
  "quality": {
    "missing_critical_info": ["string"],
    "uncertainties": ["string"],
    "inferred_fields": ["string"],
    "confidence": "high | medium | low"
  }
}
</output_contract>

<markdown_rules>
The markdown field must be readable in the Vosio UI.
Use headings in the same language as the transcript.

For Czech output, use this structure:

## Časová osa

### HH:MM:SS–HH:MM:SS — Název kapitoly
- Shrnutí:
- Témata:
- Mluvčí:
- Související rozhodnutí:
- Související úkoly:

## Rozhodnutí napříč callem
- ...

## Úkoly napříč callem
- ...

## Nejasné nebo chybějící časování
- ...

If no items exist in a section, write the equivalent of "- None." in the output language.
For Czech, write "- Žádné."
</markdown_rules>

<verification_loop>
Before finalizing, check:
- Chapters follow real topic shifts, not arbitrary time intervals.
- Timestamps are null when unavailable instead of invented.
- Speaker names and roles are not guessed from numeric IDs.
- Related action items and decisions are grounded in chapter content.
- JSON is valid and markdown matches data.
</verification_loop>', '{"type": "object", "required": ["prompt_type", "language", "metadata_used", "speaker_map", "data", "markdown", "quality"], "properties": {"data": {"type": "object", "required": ["chapters", "cross_chapter_decisions", "cross_chapter_action_items", "unresolved_timeline_items"], "properties": {"chapters": {"type": "array"}, "cross_chapter_decisions": {"type": "array"}, "unresolved_timeline_items": {"type": "array"}, "cross_chapter_action_items": {"type": "array"}}, "additionalProperties": true}, "quality": {"type": "object", "additionalProperties": true}, "language": {"type": "string"}, "markdown": {"type": "string"}, "prompt_type": {"const": "timeline_chapters"}, "speaker_map": {"type": "array", "items": {"type": "object", "additionalProperties": true}}, "metadata_used": {"type": "object", "additionalProperties": true}}, "additionalProperties": false}'::jsonb, true)
on conflict (id) do update
set
  name = excluded.name,
  processing_type = excluded.processing_type,
  prompt_text = excluded.prompt_text,
  output_schema = excluded.output_schema,
  is_system = excluded.is_system,
  updated_at = now();

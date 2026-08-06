alter table public.transcript_tasks
  add column evidence_start_ms bigint,
  add column evidence_end_ms bigint,
  add constraint transcript_tasks_evidence_range_check check (
    (evidence_start_ms is null and evidence_end_ms is null)
    or (
      evidence_start_ms is not null
      and evidence_end_ms is not null
      and evidence_start_ms >= 0
      and evidence_end_ms >= evidence_start_ms
    )
  );

alter table public.transcript_decisions
  add column evidence_start_ms bigint,
  add column evidence_end_ms bigint,
  add constraint transcript_decisions_evidence_range_check check (
    (evidence_start_ms is null and evidence_end_ms is null)
    or (
      evidence_start_ms is not null
      and evidence_end_ms is not null
      and evidence_start_ms >= 0
      and evidence_end_ms >= evidence_start_ms
    )
  );

alter table public.transcript_risks
  add column evidence_quote text,
  add column evidence_start_ms bigint,
  add column evidence_end_ms bigint,
  add constraint transcript_risks_evidence_range_check check (
    (evidence_start_ms is null and evidence_end_ms is null)
    or (
      evidence_start_ms is not null
      and evidence_end_ms is not null
      and evidence_start_ms >= 0
      and evidence_end_ms >= evidence_start_ms
    )
  );

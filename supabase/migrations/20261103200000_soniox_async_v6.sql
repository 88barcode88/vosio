-- Approve Soniox stt-async-v6 for new async transcriptions (released 03.11.2026, same price and request options as v5).
-- stt-async-v5 stays active so operations prepared or started before the web switch can still start and finish;
-- Soniox routes v5 requests to v6 after 15.12.2026, after which v5 can be deactivated by a later migration.
-- Apply this migration before deploying the web release whose default SONIOX_ASYNC_MODEL is stt-async-v6.
insert into public.recording_transcription_models_v1 (model, config_version, active)
values ('stt-async-v6', 1, true)
on conflict (model) do nothing;

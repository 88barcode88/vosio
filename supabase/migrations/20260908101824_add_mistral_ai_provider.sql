-- Extend the source schema for new server-side Mistral AI jobs and chat turns.
alter type public.ai_provider add value if not exists 'mistral';

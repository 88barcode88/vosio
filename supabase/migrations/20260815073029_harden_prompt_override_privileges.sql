-- Replace inherited Supabase default privileges with the browser-role contract used by the owner RLS policies.
revoke all privileges on table public.prompt_template_overrides from authenticated;
grant select, insert, update on table public.prompt_template_overrides to authenticated;

-- This function is invoked only by its trigger and is not a browser-callable RPC.
revoke execute on function public.validate_prompt_template_override_base_v1()
from public, anon, authenticated;

-- Support reverse foreign-key checks when an immutable system prompt is updated or deleted.
create index if not exists prompt_template_overrides_system_prompt_id_idx
  on public.prompt_template_overrides(system_prompt_id);

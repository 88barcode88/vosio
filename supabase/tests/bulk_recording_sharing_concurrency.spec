# PostgreSQL isolationtester input for a disposable full-chain DB. NOT run here.
# Every observer DO block raises on partial or non-linearizable outcomes.
setup
{
  insert into auth.users(id,email) select ('17000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bulk-race-'||n||'@fixture.test' from generate_series(1,4)n;
  insert into public.recording_projects(id,user_id,name) values('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','Bulk race');
  insert into public.recording_project_members(project_id,user_id,role) values('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','editor');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,project_id,visibility)
    select ('37000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'17000000-0000-4000-8000-000000000002',
    '17000000-0000-4000-8000-000000000002','Bulk race','realtime','completed','27000000-0000-4000-8000-000000000001',
    case when n<=2 then 'project' else 'private' end from generate_series(1,4)n;
}
teardown
{
  delete from public.recording_bulk_share_receipts where actor_id in('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002');
  delete from public.recording_sharing_audit where actor_id in('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002');
  delete from public.recordings where project_id='27000000-0000-4000-8000-000000000001';
  delete from public.recording_projects where id='27000000-0000-4000-8000-000000000001';
  delete from auth.users where id in('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000004');
}
session "a"
step "a_begin" { begin; set local role authenticated; set local request.jwt.claims='{"sub":"17000000-0000-4000-8000-000000000001","role":"authenticated"}'; }
step "a_selected"
{
  select * from public.bulk_share_recordings_v1('97000000-0000-4000-8000-000000000001',
    array['37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002']::uuid[],'selected',
    '[{"userId":"17000000-0000-4000-8000-000000000003","role":"reader"}]');
}
step "a_revoke" { select public.revoke_project_member_v1('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002'); }
step "a_commit" { commit; }
session "b"
step "b_begin" { begin; set local role authenticated; set local request.jwt.claims='{"sub":"17000000-0000-4000-8000-000000000001","role":"authenticated"}'; }
step "b_project"
{
  select * from public.bulk_share_recordings_v1('97000000-0000-4000-8000-000000000002',
    array['37000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000001']::uuid[],'project');
}
step "b_retry"
{
  select * from public.bulk_share_recordings_v1('97000000-0000-4000-8000-000000000001',
    array['37000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000001']::uuid[],'selected',
    '[{"role":"reader","userId":"17000000-0000-4000-8000-000000000003"}]');
}
step "b_single"
{
  select public.share_recording_v1('37000000-0000-4000-8000-000000000001','selected',
    '[{"userId":"17000000-0000-4000-8000-000000000004","role":"editor"}]');
}
step "b_grant_revoke" { select public.revoke_recording_grant_v1('37000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000003'); }
step "b_commit" { commit; }
session "author"
step "author_begin" { begin; set local role authenticated; set local request.jwt.claims='{"sub":"17000000-0000-4000-8000-000000000002","role":"authenticated"}'; }
step "publish"
{
  select * from public.bulk_share_recordings_v1('97000000-0000-4000-8000-000000000003',
    array['37000000-0000-4000-8000-000000000004','37000000-0000-4000-8000-000000000003']::uuid[],'project');
}
step "publish_denied"
{
  do $$ begin
    begin
      perform public.bulk_share_recordings_v1('97000000-0000-4000-8000-000000000003',
        array['37000000-0000-4000-8000-000000000004','37000000-0000-4000-8000-000000000003']::uuid[],'project');
      raise exception 'expected revoked group rejection';
    exception when insufficient_privilege then null;
    end;
  end $$;
}
step "author_commit" { commit; }
session "observer"
step "both_project"
{
  do $$ begin
    if (select count(*) from public.recordings where id in('37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002') and visibility='project')<>2
      or exists(select 1 from public.recording_access_grants where recording_id in('37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002') and revoked_at is null)
    then raise exception 'bulk project final state must be complete'; end if;
  end $$;
}
step "both_selected"
{
  do $$ begin
    if (select count(*) from public.recordings where id in('37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002') and visibility='selected')<>2
      or (select count(*) from public.recording_access_grants where recording_id in('37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002') and revoked_at is null and user_id='17000000-0000-4000-8000-000000000003')<>2
    then raise exception 'bulk selected final state must be complete'; end if;
  end $$;
}
step "only_one_request"
{
  do $$ begin
    if (select count(*) from public.recording_bulk_share_receipts where actor_id='17000000-0000-4000-8000-000000000001')<>1
      or (select count(*) from public.recording_sharing_audit where actor_id='17000000-0000-4000-8000-000000000001' and action='share')<>2
    then raise exception 'concurrent replay duplicated work'; end if;
  end $$;
}
step "single_won"
{
  do $$ begin
    if (select count(*) from public.recording_access_grants where revoked_at is null and
      ((recording_id='37000000-0000-4000-8000-000000000001' and user_id='17000000-0000-4000-8000-000000000004')
      or (recording_id='37000000-0000-4000-8000-000000000002' and user_id='17000000-0000-4000-8000-000000000003')))<>2
    then raise exception 'single/bulk must serialize'; end if;
  end $$;
}
step "grant_revoked"
{
  do $$ begin
    if exists(select 1 from public.recording_access_grants where recording_id='37000000-0000-4000-8000-000000000001' and revoked_at is null)
      or not exists(select 1 from public.recording_access_grants where recording_id='37000000-0000-4000-8000-000000000002' and revoked_at is null)
    then raise exception 'grant revoke must follow whole bulk'; end if;
  end $$;
}
step "published_before_revoke"
{
  do $$ begin
    if (select count(*) from public.recordings where id in('37000000-0000-4000-8000-000000000003','37000000-0000-4000-8000-000000000004') and visibility='project')<>2
      or (select count(*) from public.recording_sharing_audit where actor_id='17000000-0000-4000-8000-000000000002' and action='share')<>2
    then raise exception 'publish-first must commit entire group'; end if;
  end $$;
}
step "revoked_before_publish"
{
  do $$ begin
    if (select count(*) from public.recordings where id in('37000000-0000-4000-8000-000000000003','37000000-0000-4000-8000-000000000004') and visibility='private')<>2
      or exists(select 1 from public.recording_sharing_audit where actor_id='17000000-0000-4000-8000-000000000002')
      or exists(select 1 from public.recording_bulk_share_receipts where actor_id='17000000-0000-4000-8000-000000000002')
    then raise exception 'revoke-first must reject without partial writes'; end if;
  end $$;
}
# Opposite input orders cannot deadlock and last committed bulk wins completely.
permutation "a_begin" "a_selected" "b_begin" "b_project" "a_commit" "b_commit" "both_project"
permutation "b_begin" "b_project" "a_begin" "a_selected" "b_commit" "a_commit" "both_selected"
# Concurrent lost-response retry is exactly one durable request.
permutation "a_begin" "a_selected" "b_begin" "b_retry" "a_commit" "b_commit" "both_selected" "only_one_request"
# Existing single-share/grant-revoke operations use the same serialization boundary.
permutation "a_begin" "a_selected" "b_begin" "b_single" "a_commit" "b_commit" "single_won"
permutation "b_begin" "b_single" "a_begin" "a_selected" "b_commit" "a_commit" "both_selected"
permutation "a_begin" "a_selected" "b_begin" "b_grant_revoke" "a_commit" "b_commit" "grant_revoked"
# Revocation and publishing private project rows linearize at the shared lock.
permutation "author_begin" "publish" "a_begin" "a_revoke" "author_commit" "a_commit" "published_before_revoke"
permutation "a_begin" "a_revoke" "author_begin" "publish_denied" "a_commit" "author_commit" "revoked_before_publish"

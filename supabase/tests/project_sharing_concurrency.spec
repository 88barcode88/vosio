# PostgreSQL isolationtester input, disposable fully migrated DB only.
# No provider calls. Sessions use real authenticated roles and JWT subjects.
setup
{
  SET ROLE service_role;
  INSERT INTO auth.users(id,email) VALUES
    ('81000000-0000-4000-8000-000000000001','race-founder@sharing.test'),
    ('81000000-0000-4000-8000-000000000002','race-editor@sharing.test');
  INSERT INTO public.recording_projects(id,user_id,name) VALUES
    ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Race project');
  INSERT INTO public.recording_project_members(project_id,user_id,role) VALUES
    ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','editor');
  INSERT INTO public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status) VALUES
    ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','Before','realtime','82000000-0000-4000-8000-000000000001','project','completed');
  INSERT INTO public.transcripts(id,user_id,recording_id,speakers) VALUES
    ('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','[{"id":"1","role":"unknown"},{"id":"2","role":"unknown"}]');
  UPDATE auth.users SET email_confirmed_at=now() WHERE id='81000000-0000-4000-8000-000000000002';
  INSERT INTO public.recordings(id,user_id,created_by,title,source_type,visibility,status) VALUES
    ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Invitation race','upload','private','completed');
  INSERT INTO public.recording_invitations(id,token_hash,email,role,scope,recording_item_count,expires_at,created_by) VALUES
    ('85000000-0000-4000-8000-000000000001',repeat('a',64),'race-editor@sharing.test','reader','recordings',1,now()+interval '1 day','81000000-0000-4000-8000-000000000001');
  INSERT INTO public.recording_invitation_items(invitation_id,recording_id) VALUES
    ('85000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002');
  RESET ROLE;
  CREATE TABLE public.project_sharing_race_observations (observation_key text PRIMARY KEY, result jsonb NOT NULL);
  GRANT INSERT, SELECT ON public.project_sharing_race_observations TO authenticated;
}
teardown
{
  -- Exact fixture IDs in the disposable DB; no Storage fixture exists.
  DELETE FROM public.recordings WHERE id='83000000-0000-4000-8000-000000000001';
  DELETE FROM public.recordings WHERE id='83000000-0000-4000-8000-000000000002';
  DELETE FROM public.recording_projects WHERE id='82000000-0000-4000-8000-000000000001';
  DELETE FROM auth.users WHERE id IN ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002');
  DROP TABLE public.project_sharing_race_observations;
}
session "founder"
step "f_begin" { BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}'; }
step "revoke" { SELECT public.revoke_project_member_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002'); }
step "f_speaker1" { SELECT public.patch_transcript_speaker_v1('84000000-0000-4000-8000-000000000001','1',0,'Founder','unknown')->>'outcome'; }
step "revoke_invite" {
  DO $$ DECLARE actual_sqlstate text; actual_message text; changed boolean; BEGIN
    BEGIN
      changed:=public.revoke_recording_invitation_v1('85000000-0000-4000-8000-000000000001');
      INSERT INTO public.project_sharing_race_observations VALUES('revoke_invite',jsonb_build_object('changed',changed,'sqlstate','00000'));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS actual_sqlstate = RETURNED_SQLSTATE, actual_message = MESSAGE_TEXT;
      INSERT INTO public.project_sharing_race_observations VALUES('revoke_invite',jsonb_build_object('outcome','error','sqlstate',actual_sqlstate,'message',actual_message));
    END;
  END $$;
}
step "f_commit" { COMMIT; }
step "assert_revoke_first" {
  DO $$ BEGIN
    IF (SELECT title FROM public.recordings WHERE id='83000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'Before'
      OR (SELECT result FROM public.project_sharing_race_observations WHERE observation_key='edit') IS DISTINCT FROM '{"outcome":"error","sqlstate":"42501"}'::jsonb
      THEN RAISE EXCEPTION 'revoke-first requires exact 42501 and unchanged content'; END IF;
  END $$;
}
step "assert_edit_first" {
  DO $$ BEGIN
    IF (SELECT title FROM public.recordings WHERE id='83000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'Editor committed'
      OR (SELECT result FROM public.project_sharing_race_observations WHERE observation_key='edit') IS DISTINCT FROM '{"outcome":"saved","sqlstate":"00000"}'::jsonb
      THEN RAISE EXCEPTION 'edit-first requires successful authorized mutation'; END IF;
  END $$;
}
step "assert_different_speakers" {
  DO $$ BEGIN
    IF (SELECT speakers->0->>'name' FROM public.transcripts WHERE id='84000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'Founder'
      OR (SELECT speakers->1->>'name' FROM public.transcripts WHERE id='84000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'Editor'
      OR (SELECT result->>'outcome' FROM public.project_sharing_race_observations WHERE observation_key='speaker2') IS DISTINCT FROM 'saved'
      OR (SELECT result->>'version' FROM public.project_sharing_race_observations WHERE observation_key='speaker2') IS DISTINCT FROM '1'
      OR (SELECT result->>'searchVersion' FROM public.project_sharing_race_observations WHERE observation_key='speaker2') IS DISTINCT FROM '2'
      THEN RAISE EXCEPTION 'different-slot success/version/content assertion failed'; END IF;
  END $$;
}
step "assert_same_speaker" {
  DO $$ BEGIN
    IF (SELECT speakers->0->>'name' FROM public.transcripts WHERE id='84000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'Founder'
      OR (SELECT result->>'outcome' FROM public.project_sharing_race_observations WHERE observation_key='speaker1') IS DISTINCT FROM 'conflict'
      OR (SELECT result->'speaker'->>'name' FROM public.project_sharing_race_observations WHERE observation_key='speaker1') IS DISTINCT FROM 'Founder'
      OR (SELECT result->'speaker'->>'id' FROM public.project_sharing_race_observations WHERE observation_key='speaker1') IS DISTINCT FROM '1'
      OR (SELECT result->>'version' FROM public.project_sharing_race_observations WHERE observation_key='speaker1') IS DISTINCT FROM '1'
      OR (SELECT result->>'searchVersion' FROM public.project_sharing_race_observations WHERE observation_key='speaker1') IS DISTINCT FROM '1'
      THEN RAISE EXCEPTION 'same-slot conflict must return fresh slot/version/searchVersion'; END IF;
  END $$;
}
step "assert_invite_revoke_first" {
  DO $$ BEGIN
    IF (SELECT result FROM public.project_sharing_race_observations WHERE observation_key='revoke_invite') IS DISTINCT FROM '{"changed":true,"sqlstate":"00000"}'::jsonb
      OR (SELECT result FROM public.project_sharing_race_observations WHERE observation_key='accept_invite') IS DISTINCT FROM '{"outcome":"error","sqlstate":"42501"}'::jsonb
      OR (SELECT visibility FROM public.recordings WHERE id='83000000-0000-4000-8000-000000000002') IS DISTINCT FROM 'private'
      OR (SELECT revoked_at IS NOT NULL AND accepted_at IS NULL FROM public.recording_invitations WHERE id='85000000-0000-4000-8000-000000000001') IS DISTINCT FROM true
      OR EXISTS(SELECT 1 FROM public.recording_access_grants WHERE recording_id='83000000-0000-4000-8000-000000000002')
      THEN RAISE EXCEPTION 'revoke-first must confirm revoke and reject acceptance without visibility/grant residue'; END IF;
  END $$;
}
step "assert_invite_accept_first" {
  DO $$ BEGIN
    IF (SELECT result FROM public.project_sharing_race_observations WHERE observation_key='accept_invite') IS DISTINCT FROM '{"outcome":"accepted","sqlstate":"00000"}'::jsonb
      OR (SELECT result FROM public.project_sharing_race_observations WHERE observation_key='revoke_invite') IS DISTINCT FROM '{"outcome":"error","sqlstate":"55000","message":"invitation already accepted"}'::jsonb
      OR (SELECT visibility FROM public.recordings WHERE id='83000000-0000-4000-8000-000000000002') IS DISTINCT FROM 'selected'
      OR (SELECT revoked_at IS NULL AND accepted_at IS NOT NULL FROM public.recording_invitations WHERE id='85000000-0000-4000-8000-000000000001') IS DISTINCT FROM true
      OR NOT EXISTS(SELECT 1 FROM public.recording_access_grants WHERE recording_id='83000000-0000-4000-8000-000000000002' AND user_id='81000000-0000-4000-8000-000000000002' AND revoked_at IS NULL)
      THEN RAISE EXCEPTION 'accept-first must reject invitation revoke while retaining the accepted exact grant'; END IF;
  END $$;
}
session "editor"
step "e_begin" { BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}'; }
step "edit" {
  DO $$ DECLARE actual_sqlstate text; BEGIN
    BEGIN
      PERFORM public.edit_recording_title_v1('83000000-0000-4000-8000-000000000001','Editor committed');
      INSERT INTO public.project_sharing_race_observations VALUES('edit','{"outcome":"saved","sqlstate":"00000"}');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS actual_sqlstate = RETURNED_SQLSTATE;
      INSERT INTO public.project_sharing_race_observations VALUES('edit',jsonb_build_object('outcome','error','sqlstate',actual_sqlstate));
    END;
  END $$;
}
step "e_speaker2" {
  INSERT INTO public.project_sharing_race_observations VALUES('speaker2',public.patch_transcript_speaker_v1('84000000-0000-4000-8000-000000000001','2',0,'Editor','unknown'));
}
step "e_speaker1" {
  INSERT INTO public.project_sharing_race_observations VALUES('speaker1',public.patch_transcript_speaker_v1('84000000-0000-4000-8000-000000000001','1',0,'Stale editor','unknown'));
}
step "accept_invite" {
  DO $$ DECLARE actual_sqlstate text; BEGIN
    BEGIN
      PERFORM public.accept_recording_invitation_v1(repeat('a',64));
      INSERT INTO public.project_sharing_race_observations VALUES('accept_invite','{"outcome":"accepted","sqlstate":"00000"}');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS actual_sqlstate = RETURNED_SQLSTATE;
      INSERT INTO public.project_sharing_race_observations VALUES('accept_invite',jsonb_build_object('outcome','error','sqlstate',actual_sqlstate));
    END;
  END $$;
}
step "e_commit" { COMMIT; }

# Waiting step resumes only after the transaction holding the sharing lock commits.
permutation "f_begin" "revoke" "e_begin" "edit" "f_commit" "e_commit" "assert_revoke_first"
permutation "e_begin" "edit" "f_begin" "revoke" "e_commit" "f_commit" "assert_edit_first"
permutation "f_begin" "f_speaker1" "e_begin" "e_speaker2" "f_commit" "e_commit" "assert_different_speakers"
permutation "f_begin" "f_speaker1" "e_begin" "e_speaker1" "f_commit" "e_commit" "assert_same_speaker"
permutation "f_begin" "revoke_invite" "e_begin" "accept_invite" "f_commit" "e_commit" "assert_invite_revoke_first"
permutation "e_begin" "accept_invite" "f_begin" "revoke_invite" "e_commit" "f_commit" "assert_invite_accept_first"

# Supabase Schema

## Stav

Zdroj pravdy pro bootstrap nového Supabase projektu je celý timestampově seřazený řetězec:

- `supabase/migrations/20260617000000_initial_schema.sql`
- `supabase/migrations/20260804100000_add_evidence_locations.sql`
- `supabase/migrations/20260804110000_add_recording_organization.sql`
- `supabase/migrations/20260804120000_add_recording_markers.sql`
- `supabase/migrations/20260804130000_add_transcript_fulltext_search.sql`
- `supabase/migrations/20260810005550_restore_recordings_from_trash.sql`
- `supabase/migrations/20260813000000_add_recording_status_filters.sql`
- `supabase/migrations/20260813090000_add_prompt_overrides_and_job_snapshots.sql`
- `supabase/migrations/20260815073029_harden_prompt_override_privileges.sql`
- `supabase/migrations/20260827094435_add_automatic_timeline_idempotency.sql`
- `supabase/migrations/20260827100000_add_trash_retention_deadlines.sql`

Baseline vytváří core public tabulky, enumy, indexy, forced RLS policies, private Storage bucket `recordings`, storage policies a systémové prompt templates. Obsahuje i `provider_config` sloupce, Gemini provider, `timeline_chapters`, strukturované AI projekce a performance indexy pro detail nahrávky. Evidence sloupce vznikají až po `10000`, organizační sloupce/tabulky/RPC až po `11000`, `recording_markers` až po `12000`, fulltext search tabulka/RPC/indexy až po `13000`, přesná restore/purge metadata a Storage write fence až po `05550`, stavové facety až po `130000`, prompt overrides/job snapshots až po `130900`, privilege hardening až po `15073029`, automatic timeline idempotency/lease až po `20260827094435` a Trash retention deadlines/leases až po `20260827100000`. Baseline proto není kompletní source of truth; úplný fresh-project kontrakt je pouze celý uvedený ordered chain.

Existující produkční Supabase projekt může mít v `supabase_migrations.schema_migrations` historické záznamy ze starého vývojového řetězu. Pro běžný provoz je důležité, aby skutečné schema odpovídalo explicitně schválené a aplikované části aktuálního řetězce; produkční DB se kvůli baseline neresetuje.

Budoucí schema změny se přidávají jako nové timestampové migrace na konec řetězce. Tento veřejný repozitář je zdrojový kontrakt, nikoli deployment ledger: u žádného hostovaného targetu automaticky netvrdí aplikaci migrací. Nový prázdný projekt aplikuje celý řetězec v pořadí; existující projekt musí nejdřív samostatně porovnat skutečné schema a migration history a aplikovat pouze chybějící forwards.

Systémové prompt templates jsou seedované stabilními UUID a aktuálním kontraktem JSON + `markdown`. Prompty používají vstupní model `raw_text` + `segments` + `speakers`, obsahují pravidla pro speaker role a zahrnují typy `summary`, `action_items`, `meeting_minutes`, `crm_note`, `follow_up_email`, `custom_prompt` a `timeline_chapters`.

Normalizované odvozené tabulky pro práci s AI výstupy jsou `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks`. `ai_outputs` zůstává raw zdroj AI výstupu; nové tabulky jsou pracovní projekce pro checklist, obsahovou časovou osu, rozhodnutí a rizika. Každá tabulka má `user_id`, forced RLS, owner policies, anon revoke a cascade vazbu na `ai_outputs`. Authenticated klient má nad projekcemi jen čtení a u `transcript_tasks` úzké oprávnění změnit sloupec `status`; vytváření, přepis obsahu a mazání projekcí zůstává server-side přes service role.

## Evidence location forward migrace

Soubor `supabase/migrations/20260804100000_add_evidence_locations.sql` je navazující forward migrace:

- `transcript_tasks`: nullable `evidence_start_ms bigint` a `evidence_end_ms bigint`,
- `transcript_decisions`: nullable `evidence_start_ms bigint` a `evidence_end_ms bigint`,
- `transcript_risks`: nullable `evidence_quote text`, `evidence_start_ms bigint` a `evidence_end_ms bigint`.

Každý range constraint dovoluje pouze oba časy `null`, nebo oba časy non-null s `start >= 0` a `end >= start`. Migrace nepřidává žádný `GRANT` ani `POLICY`; baseline dál obsahuje právě úzký authenticated `grant update (status)` pro `transcript_tasks` a existující ownership/RLS model se nemění.

### Stav ověření této migrace

Ověřeno v source a automatických testech:

1. přesný SQL contract sloupců, paired-null range checků a absence nových grantů/policies,
2. resolver přijímá pouze unique exact contiguous quote match nad uloženými tokeny a ignoruje provider-supplied times,
3. raw `ai_outputs` se ukládá před odvozenými projekcemi a AI job přejde do `done` až po pokusu o jejich uložení,
4. component/E2E kontrakt navigace pro single audio, transcript-only a legacy segmented záznam.

Source testy ověřují očekávané evidence sloupce a všechny 3 checks. Každý deployment target stále potřebuje vlastní runtime databázový a dvouuživatelský RLS postflight.

## Recording organization forward migrace

Soubor `supabase/migrations/20260804110000_add_recording_organization.sql` je forward migrace mezi evidence a marker migrací. Přidává:

- `recording_clients`: uživatelský klient/firma,
- `recording_projects`: projekt povinně patřící jednomu klientovi,
- `recording_folders`: plochá uživatelská složka bez parent/hierarchie,
- `recording_tags`: uživatelský štítek,
- `recording_tag_links`: many-to-many vazba nahrávky a štítku,
- nullable `recordings.client_id`, `recordings.project_id` a `recordings.folder_id`.

Jedna nahrávka může mít nejvýše jednoho klienta, projekt a složku a více štítků. Check `project_id is null or client_id is not null` a kompozitní FK `(project_id, client_id, user_id) -> recording_projects(id, client_id, user_id)` vynucují, že projekt nelze přiřadit bez klienta, k jinému klientovi ani k jinému vlastníkovi. Ostatní vazby také obsahují `user_id`; cizí ID proto neprojde ani při obejití UI.

Mazací kontrakt je záměrně rozdílný:

- klientské FK z projektů a nahrávek mají `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`; běžné smazání používaného klienta je `RESTRICT`-like blokované, ale odklad umožní transakční cascade při smazání celého `auth.users` účtu,
- projekt používá PostgreSQL 15 column-list `ON DELETE SET NULL (project_id)`, takže nahrávce zůstane klient,
- složka používá `ON DELETE SET NULL (folder_id)`,
- smazání nahrávky nebo štítku kaskádově odstraní `recording_tag_links`,
- všechny organizační entity a tag links mají přímou `user_id -> auth.users(id) ON DELETE CASCADE` vazbu.

Unikátní funkční indexy nad `lower(btrim(name))` zajišťují case-insensitive názvy klientů, složek a štítků v rámci vlastníka a projektů v rámci vlastníka a klienta. Všechny organizační tabulky mají enabled i forced RLS, explicitní owner CRUD policies pro `authenticated`, revoke pro `public` a `anon`, CRUD grants pro `authenticated` a plné grants pro `service_role`.

`assign_recording_organization_v1(uuid,uuid,uuid,uuid,uuid[])` je `SECURITY INVOKER` a v jedné transakci zamkne vlastní aktivní nahrávku, ověří klienta, příslušnost projektu ke klientovi, složku a úplnou deduplikovanou sadu štítků a teprve potom nahradí všechna přiřazení. Chyba nesmí zanechat částečný update. `list_own_recordings_v1(uuid,uuid,uuid,uuid[],timestamptz,uuid,integer)` je owner-safe `SECURITY INVOKER` RPC; více štítků znamená ALL, řazení je `created_at desc, id desc` a další stránka používá tuple predicate `(created_at, id) < (p_before_created_at, p_before_id)` s limitem nejvýše 1000.

### Stav ověření organizační migrace

Source testy ověřují textový schema/security kontrakt a aplikační testy canonical URL, transakční assignment kontrakt, ALL-tag filtrování a keyset klienta. Každý deployment target musí samostatně ověřit tabulky, forced RLS, policies, constraints, indexy, RPC, skutečný two-user runtime RLS a úplnou `auth.users` cascade.

## Recording markers forward migrace

Soubor `supabase/migrations/20260804120000_add_recording_markers.sql` je navazující forward migrace. Přidává tabulku `recording_markers`:

- `id uuid` s výchozím `gen_random_uuid()`,
- `client_marker_id uuid` pro retry-safe klientský pokus,
- `recording_id uuid` a `user_id uuid`,
- `offset_ms bigint` včetně hranic `0..86400000`,
- `marker_type text` pouze `important`, `task`, `decision` nebo `follow_up`,
- nullable `note text` nejvýše 280 znaků,
- `created_at` a `updated_at`.

Unikátní constraint `(user_id, client_marker_id)` dělá jeden klientský UUID pokus idempotentní. Kompozitní foreign key `(recording_id, user_id)` odkazuje na vlastní nahrávku a maže markery při smazání nahrávky; `user_id` zároveň odkazuje na `auth.users(id)` s cascade. Index `(user_id, recording_id, offset_ms, id)` podporuje stabilní pořadí detailu.

Tabulka má zapnuté i forced RLS. Role `authenticated` dostává `select, insert, update, delete`, ale každá policy vyžaduje `auth.uid() = user_id`; `anon` nemá grant a `service_role` má plný grant. Aplikační `POST /api/recordings/{recordingId}/markers` navíc před insertem ověří session, vlastnictví nahrávky a stav jiný než `deleted`.

První úspěšný insert vrací `201`. Konflikt unikátního `(user_id, client_marker_id)` se načte znovu a vrátí `200` pouze tehdy, když se přesně shoduje `client_marker_id`, `recording_id`, `user_id`, `offset_ms`, `marker_type` i `note`. Reuse stejného UUID s jiným payloadem vrací `409`; jiné chyby se nesmí vydávat za úspěšný retry.

### Stav ověření marker migrace

Source a automatické testy ověřují textový SQL contract, validaci route, přesný retry konflikt, pořadí dotazu a aplikační full/compact/timeline chování. Každý deployment target musí samostatně ověřit forced RLS, policies, constraints, index, trigger, granty a dvouuživatelský runtime RLS.

## Transcript fulltext search forward migrace

Soubor `supabase/migrations/20260804130000_add_transcript_fulltext_search.sql` je čtvrtá forward migrace. Přidává:

- unikátní `(id, recording_id, user_id)` na `transcripts` a index `(user_id, recording_id, created_at desc, id desc)` pro přesný latest-transcript výběr,
- `transcript_search_chunks` s primárním klíčem `(transcript_id, position)`, owner-safe kompozitním FK, volitelnými časy, speaker labelem, textem, stored `tsvector` a GIN indexem,
- generated metadata search vectors a GIN indexy pro název nahrávky, klienta, projekt, složku a štítek,
- authenticated `SECURITY INVOKER` RPC `search_own_recordings_v1`,
- service-only atomické RPC `replace_transcript_search_chunks_v1`,
- trigger `transcripts_refresh_search_fallback`, který při insert/update transcriptu nahradí chunks jedním raw-text fallbackem bez času,
- jednorázový source backfill existujících neprázdných `transcripts.raw_text` do fallback chunků.

Přesný aplikační index odvozuje po sobě jdoucí renderovatelné speaker bloky ze stejných tokenů jako transcript UI. Každý chunk zachovává text, stabilní 1-based pozici a dostupný čas. Pokud speaker bloky nejsou renderovatelné, používá se jediný trimmed `raw_text` chunk bez času; prázdný transcript nemá chunk. Async, segment-combine, realtime draft/final, recovery, ruční import a změna speaker metadata po uložení volají `replace_transcript_search_chunks_v1`. Selhání tohoto doplňkového indexování zachová durable transcript i triggerový raw fallback a vrací pouze stabilní nefatální warning.

Search RPC normalizuje whitespace a omezuje dotaz na 120 znaků, parsuje ho přes `websearch_to_tsquery('simple', query_text)` a vrací právě jednu vítěznou shodu pro každou nahrávku. Transcript část pro každou nahrávku používá právě nejnovější vlastní transcript podle `created_at desc, id desc`; starší transcript se po existenci novějšího neprohledává. Eligible množina vyžaduje `auth.uid()`, `recordings.user_id = auth.uid()`, `status <> 'deleted'` a stejné client/project/folder/ALL-tag filtry jako workspace. Výsledky jsou řazené podle ranku, data a recording ID, obsahují pouze excerpt, volitelný `match_start_ms`/`match_end_ms` a `total_count`, nikoli celé transcripty.

V1 RPC `list_own_recordings_v1` a `search_own_recordings_v1` zůstávají pouze pro kompatibilitu. Současné UI bezpodmínečně používá `list_own_recordings_v2` bez `q` a `search_own_recordings_v2` s neprázdným `q`; V2 přidává přesný status filtr. Search UI používá bounded `page` a `limit/offset` stránkování po 25 výsledcích. To se nesmí zaměnit s keysetem běžného V2 listu `(created_at, id)` ani s keysetem servisního backfillu, který postupuje vzestupně podle transcript `id`.

Source migrace `20260813000000_add_recording_status_filters.sql` přidává oba V2 list/search kontrakty a `count_own_recording_statuses_v1`. Toto RPC vrací přesné facety přes celý aktuální `q`, organizační filtry a ALL sadu štítků. Facety ignorují aktivní `status`; `Smazáno` je samostatný úplný počet Koše.

Tabulka `transcript_search_chunks` má enabled i forced RLS. `authenticated` má pouze `select` vlastních řádků, `anon` nemá grant, `service_role` má plný grant. Search RPC je invoker a executable jen pro `authenticated`; replace RPC je executable jen pro `service_role`. Triggerová funkce je `SECURITY DEFINER`, ale není executable pro `public`, `anon` ani `authenticated`.

Repo obsahuje servisní příkaz `npm run search:backfill`. Vyžaduje explicitní `--environment=disposable|live`; live navíc `--allow-live`, podporuje `--dry-run` a bounded batch `1..500`. Jeho spuštění je samostatné target-specific provozní rozhodnutí; migrace `13000` už obsahuje inline fallback backfill.

### Stav ověření search migrace

Source/unit/component/E2E testy pokrývají SQL textový kontrakt, chunk derivaci, latest pořadí, query parsing, owner/deleted/organization filtry, stránkování, deep-link resolvery, raw/manual fallback, ambiguity/no-false-highlight, one-shot warning a single/none/segmented playback chování. Každý deployment target musí samostatně ověřit forced RLS, indexy, funkce, trigger, granty, authenticated GIN `EXPLAIN`, two-user runtime RLS a current-vs-old/manual/raw/deleted behavior.

## Forward migrations release gate

Fresh-project pořadí zůstává závazné: baseline, evidence `10000`, organization `11000`, markers `12000`, search `13000`, Trash restore/purge `05550`, status filters `130000`, prompt overrides/job snapshots `130900`, privilege hardening `15073029`, automatic timeline idempotency `20260827094435` a Trash retention `20260827100000`. Každý target potřebuje vlastní schema/history preflight, apply pouze chybějících migrací a databázový postflight před app deployem. Legacy historii nemaž ani neresetuj jen proto, aby odpovídala fresh baseline.

## Trash retention deadlines and cleanup leases

Source migrace `20260827100000_add_trash_retention_deadlines.sql` přidává na `recordings` validovaný `trash_retention_hours`, `purge_after` a bounded `purge_attempt_count`. Přechod z aktivního stavu do `deleted` atomicky snapshotne neměnný `deleted_at`, retenci a deadline. Update již smazaného řádku snapshot zachová, restore retention/claim metadata vyčistí a pozdější nový delete je vypočte znovu. Existující deleted řádky zachovají své historické `deleted_at`; backfill doplní `720` hodin a `purge_after = deleted_at + interval '30 days'`. Partial due index je `(purge_after, id) where status = 'deleted'`.

Service-only RPC `claim_due_recording_purges_v1` vybírá due řádky ve stabilním pořadí, používá row locking se `skip locked`, přiděluje UUID lease token, bere nejvýše 20 řádků, nepřekračuje pět pokusů a reclaimuje až po 15 minutách stejně jako ruční purge. Refresh, finalize a release RPC mění jen řádek s přesným claim tokenem; claim loss proto nedovolí dokončit cizí lease. Release se používá jen před prvním Storage delete pokusem. Po zahájení mutace zůstává claim držený pro bezpečný stale retry a trigger mezitím blokuje restore. Všechny čtyři funkce jsou `SECURITY INVOKER`, mají prázdný `search_path`, plně kvalifikované objekty, explicitní revoke pro `PUBLIC`, `anon`, `authenticated` a execute pouze pro `service_role`. Trigger helper `recordings_manage_trash_metadata()` má stejný direct-call ACL; revokace nemění spuštění již instalovaného PostgreSQL triggeru při update řádku.

Source Edge Function `supabase/functions/trash-retention` volá tato RPC a maže private objekty pouze přes Supabase Storage API, nikdy SQL proti `storage.objects`. Je bounded na batch 20 a přesně dva paralelní itemy, ověřuje kanonický owner/recording prefix a fail-closed vyžaduje vlastní scheduler token i přesný enable secret `true`. Repo neobsahuje cron ani schedule. Zdrojový repozitář sám nepotvrzuje aplikaci migrace, nasazení funkce, nastavení secrets ani povolení cleanupu na žádném cíli.

## Public tabulky

- `recordings`
- `transcription_jobs`
- `transcripts`
- `prompt_templates`
- `prompt_template_overrides` po aplikaci forward migrace `20260813090000`
- `ai_processing_jobs`
- `automatic_timeline_intents` po aplikaci forward migrace `20260827094435`
- `ai_outputs`
- `transcript_tasks`
- `transcript_chapters`
- `transcript_decisions`
- `transcript_risks`
- `recording_clients` po aplikaci forward migrace `20260804110000`
- `recording_projects` po aplikaci forward migrace `20260804110000`
- `recording_folders` po aplikaci forward migrace `20260804110000`
- `recording_tags` po aplikaci forward migrace `20260804110000`
- `recording_tag_links` po aplikaci forward migrace `20260804110000`
- `recording_markers` po aplikaci forward migrace `20260804120000`
- `transcript_search_chunks` po aplikaci forward migrace `20260804130000`
- `audit_logs`

## Enumy

`ai_processing_type` obsahuje:

- `summary`
- `action_items`
- `meeting_minutes`
- `timeline_chapters`
- `structured_extraction`
- `crm_note`
- `follow_up_email`
- `custom_prompt`

## Systémové prompt templates

Seed migrace vytváří idempotentní systémové prompty v `prompt_templates` pro:

- `summary`
- `action_items`
- `meeting_minutes`
- `timeline_chapters`
- `crm_note`
- `follow_up_email`
- `custom_prompt`

Systémové prompty mají stabilní UUID, `is_system = true` a `user_id = null`. Authenticated uživatelé je mohou číst přes policy `prompt templates select own and system`. Vlastní uživatelské prompty musí mít `is_system = false` a `user_id = auth.uid()`.

Seed migrace pro systémové prompty jsou idempotentní. První seed migrace používá stabilní UUID konflikty pro základní prompty. Doplňovací migrace pro `crm_note` a `follow_up_email` vkládá řádky jen tehdy, když pro daný `processing_type` neexistuje systémový prompt s `is_system = true` a `user_id = null`, aby nepřepsala případnou dříve doplněnou systémovou variantu.

`prompt_text` je šablona pro server-side AI worker. Worker podporuje placeholdery `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}` a `{{custom_prompt}}`. Kvůli starším šablonám zůstávají podporované také aliasy `{{transcript_text}}`, `{{transcript}}` a `{{transcript_segments}}`. `output_schema` je volitelný JSON Schema kontrakt očekávaného strukturovaného výstupu pro prompt a provider request. Runtime dnes JSON odpověď parsuje a parsed objekt ukládá do `ai_outputs.output_json`, ale striktní JSON Schema validace zatím není aktivní aplikační gate.

Systémové prompty rozlišují business roli mluvčích, pokud je dostupná z transcriptu nebo metadata: `client_customer`, `delivery_team` a `unknown`. Číselné Soniox štítky typu `Mluvčí 1` samy o sobě nestačí k určení role.

`transcripts.speakers` se plní při uložení async i realtime přepisu jako JSON pole speaker souhrnů z `segments`: speaker id, UI label, volitelné ruční jméno, počet tokenů, první/poslední čas, role a zdroj přiřazení. Výchozí role je `unknown`, dokud ji neurčí uživatel nebo samostatná AI inference.

## Prompt overrides a job snapshots

`20260813090000_add_prompt_overrides_and_job_snapshots.sql` zachovává `prompt_templates` jako neměnné systémové základy s autoritativním `processing_type` a `output_schema`. Nová forced-RLS tabulka `prompt_template_overrides` má nejvýše jeden řádek na `(user_id, system_prompt_id)` a ukládá pouze `prompt_text`, `is_active` a kladnou monotónní `revision`; schema sloupec nemá.

Authenticated save/reset používají `SECURITY INVOKER` funkce `save_prompt_template_override_v1` a `reset_prompt_template_override_v1`. Obě odvozují vlastníka z `auth.uid()`, zamykají existující řádek a vyžadují expected revision. Resolver `resolve_effective_prompt_template_v1` vrací owner override text, pokud je aktivní, ale název, processing type a schema vždy čte ze systémového základu. Browser-callable RPC grant je pouze pro `authenticated`; provozní `service_role` si ponechává `EXECUTE`. Tabulka má forced owner RLS a `anon` nemá grant.

Opravná migrace `20260815073029_harden_prompt_override_privileges.sql` nejdřív revokuje zděděné tabulkové granty role `authenticated` a vrací pouze `SELECT`, `INSERT` a `UPDATE`. Trigger-only `validate_prompt_template_override_base_v1()` po ní nemá přímý `EXECUTE` pro `PUBLIC`, `anon` ani `authenticated`. Samostatný index na `prompt_template_overrides(system_prompt_id)` pokrývá reverse foreign-key lookup; partial jobs index na nenulovém `prompt_override_id` zůstává záměrně beze změny. Postflight každého targetu musí ověřit přesný ACL, effective function privileges, validní a ready index, forced RLS, policies a job snapshot invarianty.

`ai_processing_jobs` po migraci ukládá `prompt_override_id`, `prompt_source`, `prompt_name_snapshot`, `prompt_text_snapshot`, `prompt_output_schema_snapshot`, `prompt_revision_snapshot` a `prompt_snapshot_exact`. Nový quick-action job zapisuje přesný snapshot před provider callem a má `prompt_snapshot_exact=true`. Historické řádky se rekonstruují z dostupného `prompt_id`, ale vždy mají `prompt_snapshot_exact=false`; chybějící identita se označí `unknown`. Reset override staré snapshoty ani `ai_outputs` nemění.

Expand fáze migrace zachovává kompatibilitu s dosud nasazeným `0.1.5` insertem do `ai_processing_jobs`, který posílá `prompt_id`, ale nové snapshot sloupce ještě nezná. `SECURITY INVOKER` `BEFORE INSERT` trigger před kontrolou omezení dohledá autoritativní `prompt_templates` řádek a uloží jeho přesný snapshot; při null nebo chybějícím promptu zapíše `prompt_source='unknown'` a `prompt_snapshot_exact=false`. Pokud nový build dodá `prompt_source` a celý snapshot sám, trigger payload nemění a platnost dál vynucují checky a cizí klíče. Helper nemá přímý execute grant pro `PUBLIC`, `anon` ani `authenticated`.

Legacy nesystémové řádky v `prompt_templates` zůstávají uložené, ale editor `AI prompty` je v této fázi nezobrazuje. Aktivní quick-action kontrakt obsahuje přesně `summary`, `action_items`, `timeline_chapters`, `meeting_minutes`, `crm_note` a `follow_up_email`; browser posílá jen processing type a model, nikdy prompt ID, schema ani user ID.

## Automatic timeline idempotency a lease

`20260827094435_add_automatic_timeline_idempotency.sql` přidává do `ai_processing_jobs` additive pole `execution_mode`, `automatic_idempotency_key`, `attempt_count`, `max_attempts`, `lease_token` a `lease_expires_at` a do `transcripts` nenulovaný `completion_generation_key`. Existující a nové manuální řádky mají default `execution_mode='manual'`; automatický řádek musí být exact-snapshot `timeline_chapters` job s nenulovým idempotency digestem. Partial unique index povolí jen jeden automatický job na persistovanou generation identity a unique index `ai_outputs(processing_job_id)` jen jeden raw output na job. Nová forced-RLS tabulka `automatic_timeline_intents` drží service-only completion-time consent a celý immutable model/prompt/provider snapshot před prvním enqueue pokusem. Řádek bez consentu se nevytváří a historický transcript bez intentu se nerecoveruje.

RPC `complete_transcript_generation_v1`, `enqueue_automatic_timeline_job_v1`, `claim_automatic_timeline_job_v1` a `settle_automatic_timeline_job_v1` jsou `SECURITY INVOKER`, mají prázdný `search_path`, odebraný `EXECUTE` pro `PUBLIC`, `anon` i `authenticated` a explicitní grant pouze pro `service_role`. Completion RPC zamkne owner transcript `FOR UPDATE`, rozhodne same/new generation, vybere a `FOR SHARE` zamkne systémový prompt a aktivní override, uloží přesný intent, provede replacement cleanup právě jednou a teprve ve stejné transakci nastaví generation marker i recording `completed`. Jakákoli prompt/intent chyba rollbackne completion; ztracená odpověď po commitu je obnovitelná z intentu. Enqueue používá stejný unique digest; souběžné recovery proto vrátí jediný durable job. Claim přijme queued/failed job s remaining attempts nebo `running` job až po deterministické expiraci lease; každý claim zvýší attempt count. Settlement vyžaduje přesný aktuální lease token. Migrace neobsahuje cron ani plánovanou úlohu. Každý target stále potřebuje vlastní preflight, apply, postflight a rollback evidence.

Před jakýmkoli apply `20260827094435` na existující target musí oprávněný operátor spustit přesně tento read-only preflight:

```sql
select
  processing_job_id,
  count(*) as output_count,
  array_agg(id order by created_at, id) as ai_output_ids
from public.ai_outputs
group by processing_job_id
having count(*) > 1
order by processing_job_id;
```

Nulový výsledek je nutná, nikoli postačující podmínka apply. Jakýkoli řádek blokuje live apply a vyžaduje explicitní lineage review každého outputu. Migrace stejný invariant kontroluje fail-closed ještě před unique indexem a vyhodí výjimku; neobsahuje blind dedup ani delete. Každý target zůstává `live apply blocked pending preflight`, dokud není doložen jeho vlastní nulový výsledek a schválen další rollout krok.

## Přístupový model

Authenticated uživatel:

- může číst vlastní nahrávky, joby, přepisy, AI joby, AI výstupy a audit metadata,
- může číst vlastní strukturované AI projekce a měnit pouze `transcript_tasks.status`,
- může vytvářet/upravovat/mazat vlastní `recordings`,
- po aplikaci organization migrace může přes forced owner RLS spravovat jen vlastní klienty, projekty, ploché složky, štítky a jejich vazby; assignment a filtrovaný seznam používají pouze authenticated RPC granty,
- po aplikaci marker migrace může přes forced RLS číst a měnit pouze vlastní `recording_markers`,
- po aplikaci search migrace může přes forced RLS číst pouze vlastní `transcript_search_chunks` a spouštět owner-safe `search_own_recordings_v1`,
- může vytvářet/upravovat/mazat vlastní nesystémové `prompt_templates`,
- po aplikaci prompt override migrace může přes forced RLS a revision-safe RPC uložit nebo resetovat jen vlastní `prompt_text` override,
- může pracovat jen se Storage objekty v cestě `user_id/...`.

Server/worker přes `service_role`:

- vytváří a upravuje `transcription_jobs`,
- ukládá `transcripts`,
- vytváří a upravuje `ai_processing_jobs`,
- po aplikaci automatic timeline migrace persistuje a čte `automatic_timeline_intents` pouze přes service-role boundary,
- ukládá `ai_outputs`,
- ukládá odvozené `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks`,
- zapisuje `audit_logs`,
- po aplikaci marker migrace má plný grant nad `recording_markers`; běžný marker endpoint přesto používá authenticated session a owner RLS,
- po aplikaci search migrace atomicky nahrazuje `transcript_search_chunks` přes service-only RPC; běžnému authenticated klientovi tento zápis přístupný není.

Manuální restart přepisu používá stejnou server-side kontrolu vlastnictví. Při `POST /api/recordings/{recordingId}/transcription?restart=1` se nejdřív založí nový Soniox job a až potom se smažou existující transcripty pro danou nahrávku; navázané `ai_processing_jobs` a `ai_outputs` se odstraní přes kaskádové FK. Staré dokončené `transcription_jobs` zůstávají kvůli usage historii, běžící lokální joby se označí jako `cancelled`.

Anon role:

- nemá žádnou RLS policy na uživatelských public tabulkách,
- nemá žádnou storage policy na bucket `recordings`,
- při runtime ověření nevidí žádné `recordings` řádky.

RLS je zapnuté a forced na všech uživatelských public tabulkách. Policies jsou vázané na `to authenticated` a vlastnictví přes `(select auth.uid()) = user_id`, kromě systémových `prompt_templates`, které může authenticated uživatel číst, ale ne upravovat.

## Storage

Bucket:

- `recordings`
- private
- baseline per-bucket limit 50 MB na soubor (`52428800` bytes); runtime aplikace načítá aktuální `file_size_limit`, takže placený projekt může použít vyšší hodnotu v mezích svého globálního Storage limitu
- baseline bucket obsahuje historicky širší Soniox MIME allowlist včetně AAC, AIFF, AMR a ASF; produktový upload z něj runtime používá pouze průnik s běžným katalogem M4A, MP3, WAV, WebM, OGG, FLAC a MP4

Formát storage path:

```text
{user_id}/{recording_id}/{filename}
```

Authenticated INSERT/UPDATE do bucketu navíc ověřuje, že druhý segment je ID vlastněného řádku `recordings`, jeho stav není `deleted` a nemá aktivní purge claim. Service role tímto omezením není dotčená. Permanentní purge používá neměnné `deleted_at` a inkluzivní hranici 24 hodin kvůli maximální platnosti Supabase TUS URL; před DB delete opakovaně ověří prázdný prefix celé nahrávky.

Nová live nahrávka pod limitem používá jeden finální objekt:

```text
{user_id}/{recording_id}/live/recording.<ext>
```

`recordings.storage_path` ukazuje přímo na tento objekt. Pro kompatibilitu aplikace stále rozpozná starší segmentovaný prefix `{user_id}/{recording_id}/live/`; u takového záznamu vytvoří async znovupřepis jeden řádek v `transcription_jobs` pro každý nalezený objekt, se společným `provider_config.batch_id` a `provider_config.audio_source = supabase_recording_segment`.

## Deployment verification boundary

Tento veřejný schema dokument neuchovává stav konkrétního hostovaného projektu. Před deployem proti existujícímu targetu ověř celý ordered chain, skutečné tabulky a sloupce, constraints, indexy, granty, forced RLS, dvouuživatelskou izolaci, job snapshot invarianty a migration history. Produkční databázi kvůli porovnání s fresh baseline neresetuj a starší historii nepřepisuj bez samostatně schváleného reconciliation plánu.

# Supabase Schema

## Stav

Zdroj pravdy pro nový Supabase projekt je jedna baseline migrace:

- `supabase/migrations/20260617000000_initial_schema.sql`

Baseline vytváří public tabulky, enumy, indexy, forced RLS policies, private Storage bucket `recordings`, storage policies a finální systémové prompt templates. Obsahuje i `provider_config` sloupce, Gemini provider, `timeline_chapters`, strukturované AI projekce a performance indexy pro detail nahrávky.

Existující produkční Supabase projekt může mít v `supabase_migrations.schema_migrations` historické záznamy ze starého vývojového řetězu. Pro běžný provoz je důležité, aby aktuální schema odpovídalo baseline; produkční DB se kvůli baseline neresetuje.

Budoucí schema změny se přidávají jako nové migrace za baseline a aplikují se do obou Supabase projektů stejně.

Systémové prompt templates jsou seedované stabilními UUID a aktuálním kontraktem JSON + `markdown`. Prompty používají vstupní model `raw_text` + `segments` + `speakers`, obsahují pravidla pro speaker role a zahrnují typy `summary`, `action_items`, `meeting_minutes`, `crm_note`, `follow_up_email`, `custom_prompt` a `timeline_chapters`.

Normalizované odvozené tabulky pro práci s AI výstupy jsou `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks`. `ai_outputs` zůstává raw zdroj AI výstupu; nové tabulky jsou pracovní projekce pro checklist, obsahovou časovou osu, rozhodnutí a rizika. Každá tabulka má `user_id`, forced RLS, owner policies, anon revoke a cascade vazbu na `ai_outputs`. Authenticated klient má nad projekcemi jen čtení a u `transcript_tasks` úzké oprávnění změnit sloupec `status`; vytváření, přepis obsahu a mazání projekcí zůstává server-side přes service role.

## Public tabulky

- `recordings`
- `transcription_jobs`
- `transcripts`
- `prompt_templates`
- `ai_processing_jobs`
- `ai_outputs`
- `transcript_tasks`
- `transcript_chapters`
- `transcript_decisions`
- `transcript_risks`
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

## Přístupový model

Authenticated uživatel:

- může číst vlastní nahrávky, joby, přepisy, AI joby, AI výstupy a audit metadata,
- může číst vlastní strukturované AI projekce a měnit pouze `transcript_tasks.status`,
- může vytvářet/upravovat/mazat vlastní `recordings`,
- může vytvářet/upravovat/mazat vlastní nesystémové `prompt_templates`,
- může pracovat jen se Storage objekty v cestě `user_id/...`.

Server/worker přes `service_role`:

- vytváří a upravuje `transcription_jobs`,
- ukládá `transcripts`,
- vytváří a upravuje `ai_processing_jobs`,
- ukládá `ai_outputs`,
- ukládá odvozené `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks`,
- zapisuje `audit_logs`.

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
- povolené audio MIME typy: AAC, FLAC, MP4/M4A, MPEG/MP3, OGG, WAV, WEBM

Formát storage path:

```text
{user_id}/{recording_id}/{filename}
```

Nová live nahrávka pod limitem používá jeden finální objekt:

```text
{user_id}/{recording_id}/live/recording.<ext>
```

`recordings.storage_path` ukazuje přímo na tento objekt. Pro kompatibilitu aplikace stále rozpozná starší segmentovaný prefix `{user_id}/{recording_id}/live/`; u takového záznamu vytvoří async znovupřepis jeden řádek v `transcription_jobs` pro každý nalezený objekt, se společným `provider_config.batch_id` a `provider_config.audio_source = supabase_recording_segment`.

## Aplikace migrace

Core migrace už byla aplikovaná přes MCP server `supabase-vosio`.

Ověřeno:

1. public tabulky existují,
2. RLS je zapnuté a forced na všech uživatelských public tabulkách,
3. bucket `recordings` existuje a je private,
4. globální Storage file size limit je nejméně tak vysoký jako explicitní `recordings.file_size_limit`, který aplikace používá jako runtime limit,
5. bucket má audio MIME allowlist,
6. enum `ai_processing_type` obsahuje `timeline_chapters`,
7. systémová šablona `System timeline chapters` existuje jako globální `prompt_templates` řádek,
8. role `anon` nemá granty na uživatelské public tabulky.

Runtime chování s reálným authenticated uživatelem:

1. user vidí jen vlastní řádky,
2. storage upload funguje pouze do složky vlastního `user_id`,
3. frontend umí vytvořit `recordings` řádek a nahrát soubor do private bucketu,
4. server-side service role vytváří Soniox `transcription_jobs`,
5. polling endpoint ukládá hotový text do `transcripts`,
6. AI output ukládání je navázané na `ai_processing_jobs` a `ai_outputs`,
7. strukturované AI projekce se ukládají do `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks`.

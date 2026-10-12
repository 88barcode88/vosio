# Existující cíle a ručně aplikované migrace

Migrační řetězec repozitáře je kanonický pro novou prázdnou databázi. Existující instalace může mít starší nebo ručně aplikované změny: shodné schéma ještě neznamená shodnou historii migrací.

Před upgradem správce zvolí přesný vlastní target, pořídí ověřenou obnovitelnou zálohu a načte skutečné schema/ledger, grants/RLS, constraints, aktivní operace a Storage stav. Srovná je s přesnými zdrojovými migracemi. Neznámý drift blokuje automatický apply; samotný název větve target neurčuje.

U takového cíle se provede pouze schválený forward postup s odpovídajícím preflightem, rollback rehearsal a postflightem. Neresetuje se databáze, nepřepisují se už aplikované SQL soubory a neprovádí se tichá oprava ledgeru. Zápis do historie je samostatná operace, nikoli vedlejší efekt kontroly schématu.

Přechod na nová sdílená oprávnění/capture RPC vyžaduje kompatibilní web a workery. Inkompatibilní přechod vyžaduje domluvenou pauzu zápisů; pouhý návrat starého webu nemusí být bezpečný. Zachovejte přijaté operace, nahrávky, tokenovou custody a uložené snapshoty; incident řešte připravenou obnovou nebo novou forward opravou.

Zveřejnění aplikace neurčuje stav žádné externí databáze. Source, disposable SQL proof, ledger reconciliation, vzdálený apply, deploy a uživatelská akceptace se reportují odděleně.

## Kontrola existující historie

Zdrojové forwards zahrnují `20260810005550_restore_recordings_from_trash.sql`, `20260813000000_add_recording_status_filters.sql`, `20260813090000_add_prompt_overrides_and_job_snapshots.sql` a `20260815073029_harden_prompt_override_privileges.sql`. U každého cíle ověřte funkce, constraints a grants i odpovídající záznamy v `supabase_migrations.schema_migrations`. Ručně aplikované schéma může v ledgeru chybět; tento dokument netvrdí, že kterákoli migrace byla aplikována na konkrétní externí instalaci.

Starý build nemusí splňovat nový databázový kontrakt. Například snapshoty promptu musí zachovat `prompt_id` i validaci `BEFORE INSERT`; kompatibilitu webu a workerů ověřte po apply samostatně. Static checks are not runtime verification: source test ani úspěšný build nepotvrzuje běh starého deploymentu proti novému schématu.

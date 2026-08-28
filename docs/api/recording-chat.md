# Recording chat API

## Co chat dělá

`Chat` je uložený vícekolový rozhovor nad jedním hotovým a uloženým přepisem nahrávky. Není to live chat nad audiem ani náhrada přepisu: bez uloženého `transcripts` řádku tab zobrazí nedostupný stav. Pro jednoho vlastníka a konkrétní `transcript_id` existuje nejvýše jedno vlákno; historie se po refreshi a při návratu k nahrávce znovu načte.

Každý tah ukládá otázku, vybraný model a provider, snapshot systémového promptu, usage, stav a bezpečnou chybu nebo odpověď. Chat používá stávající OpenAI/Gemini modelový katalog, serverové adaptéry a uložený speaker context. Browser neposílá audio, Storage URL, provider, prompt ani transcriptový kontext.

## HTTP kontrakt

Obě route vyžadují platnou Supabase session a vrací stejný `404` pro chybějící i cizí přepis.

### `GET /api/transcripts/{transcriptId}/chat`

Vrátí bezpečnou owner-scoped projekci existujícího vlákna a chronologicky řazených tahů. Pokud pro vlastněný přepis vlákno ještě nevzniklo, vrátí `thread: null` a prázdné `turns`. Při bezpečném čtení také uzavře stale `running` tah starší než deset minut jako `failed`.

Do browseru se neposílá uložený prompt, provider response ID ani raw context. Každý vrácený tah obsahuje otázku, model/provider, stav, odpověď, sanitizovanou chybu, usage a pouze ověřenou evidence s `quote`, `startMs` a `endMs`.

### `POST /api/transcripts/{transcriptId}/chat`

Přijímá přesně tento JSON objekt:

```json
{
  "clientTurnId": "UUID",
  "model": "povolený model z aktuálního katalogu",
  "question": "neprázdná otázka do 8000 znaků"
}
```

Server ověří usera a vlastnictví přepisu, sám vybere provider podle modelu, vytvoří nebo načte vlákno a atomicky persistuje `running` tah. Poté vytvoří omezený kontext z uloženého transcriptu, speaker contextu a nejnovější dokončené historie. Úspěch vrátí bezpečnou projekci vlákna a dokončeného tahu.

Tentýž `clientTurnId` stejného uživatele je idempotentní: vrátí původní tah a nesmí znovu volat providera. Stejné UUID pro jiný přepis vrátí `409`. V jednom vláknu může být nejvýše jeden `running` tah, takže souběžný nový request vrátí `409`. Nové claimy mají best-effort per-instance limit deset za minutu na uživatele; limit je před placeným provider callem a odpověď `429` nese `Retry-After`.

Neplatná identita/payload vrací `400`, nepřihlášený user `401`, cizí nebo neexistující přepis `404`, chybějící systémový prompt `503` a bezpečně sanitizovaná provider chyba `502`. Response neobsahuje raw transcript ani provider detail; vrací pouze otázku jako součást bezpečně uloženého tahu.

## Persistence, evidence a ownership

Chat je v tabulkách `transcript_chat_threads` a `transcript_chat_turns`. Kompozitní foreign keys vážou thread a turn na stejný `user_id`, `recording_id` a `transcript_id`; smazání nebo nahrazení přepisu proto smaže i starý chat. Authenticated user má přes forced RLS pouze `SELECT` svých řádků. Pro `authenticated` nejsou granty ani policies pro create, update nebo delete; tyto mutace provádí pouze autorizovaný server přes `service_role` po owner kontrole.

Provider vrací nejvýše osm krátkých citací, nikoli autoritativní čas nebo speaker ID. Server každou citaci hledá proti plným uloženým Soniox tokenům. Pouze jedinečný exact contiguous match uloží quote i `start_ms`/`end_ms`; nejednoznačná, nenalezená nebo duplicitní citace se nezobrazí jako důkaz. Kliknutí na uložený důkaz vede do existující navigace přepisu a, když je k dispozici jedno audio, i na odpovídající čas přehrávače.

## Source migrace a self-host provoz

Pro chat jsou nutné tyto source migrace ve zcela přesném pořadí:

1. `20260828130631_add_transcript_chat.sql`
2. `20260828131010_add_transcript_chat_schema.sql`

První přidává pouze `recording_chat` do enumu. Druhá seeduje systémový prompt a vytváří tabulky, constraints, indexy, forced RLS, úzké select-only granty a owner policies. Přítomnost těchto SQL souborů v Git repu znamená pouze **source migration**. **Applied** znamená, že byly ve stejném pořadí vykonány na konkrétním pojmenovaném Supabase targetu. **Deployed** znamená, že je nasazen build aplikace s route a UI. **Live** vyžaduje vlastní postflight na daném targetu a ověřený běh s reálnou session. Tyto stavy se z toho navzájem neodvozují.

Self-host instalace používá stejný Supabase projekt jako nahrávky a přepisy, ne druhý projekt. Chat nepřidává žádnou environment proměnnou: server pro zvolený OpenAI model používá existující `OPENAI_API_KEY`, pro zvolený Gemini model `GEMINI_API_KEY`; serverová persistence vyžaduje existující `SUPABASE_SERVICE_ROLE_KEY` a připojení používá `NEXT_PUBLIC_SUPABASE_URL` a `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Všechny tajné hodnoty zůstávají pouze v deployment runtime nebo `.env.local`, nikdy v Git výstupu ani diagnostice.

Bez vypsání tajných hodnot lze ověřit source instalaci takto:

1. potvrdit, že oba výše uvedené migrační soubory jsou tracked a v uvedeném pořadí,
2. na konkrétním cíli read-only zkontrolovat migrační ledger a schema, před schváleným apply nic neměnit,
3. po schváleném apply ověřit forced RLS, select-only grants a owner boundary se dvěma rozdílnými uživateli,
4. po nasazení se přihlásit, otevřít nahrávku s uloženým přepisem, načíst prázdnou historii, poslat jeden UUID-tagged dotaz a po refreshi ověřit stejný uložený tah a navigaci jen u ověřené evidence.

Tento postup nevyžaduje konkrétní hostingovou platformu. Nikdy nevkládej skutečné klíče, transcript nebo provider response do testovacího výstupu.

# Product Concept

## Cíl

Vytvořit robustní PWA aplikaci, kde uživatelé mohou:

1. nahrát existující audio soubor z mobilu nebo PC,
2. nahrávat audio přímo v aplikaci,
3. získat přepis přes Soniox,
4. uložit audio, metadata, přepisy a AI výstupy do Supabase,
5. zpracovat přepis přes AI API,
6. spravovat a mazat vlastní data.

Aplikace má nahrazovat potřebu používat nativní Soniox aplikaci a má umožnit vlastní API a vlastní workflow.

## Varianta A: upload hotové nahrávky

Uživatel má existující nahrávku v mobilu nebo na PC.

Požadavky:

- upload audio souboru,
- podpora minimálně `mp3`, `m4a`, `wav`, `webm`,
- private Supabase Storage,
- metadata v tabulce `recordings`,
- Soniox async transcription job vytvořený server-side,
- uložení finálního transcriptu do `transcripts`,
- AI processing nad hotovým transcriptem,
- viditelný stav uploadu, přepisu a AI zpracování.

## Varianta B: nahrávání v aplikaci

Uživatel nahrává přímo v aplikaci.

### B1 Standard recording

Požadavky:

- nahrávání přes browser MediaRecorder,
- start, pause, resume a stop,
- zobrazení uplynulého času,
- vytvoření finálního audio Blobu,
- upload přes stejnou storage cestu jako Varianta A,
- `source_type = in_app_recording`,
- přepis po dokončení nahrávání.

### B2 Realtime transcription

Cílová schopnost:

- realtime audio stream do Soniox přes WebSocket nebo Web SDK,
- průběžné zobrazení transcript segmentů,
- průběžné ukládání bezpečně použitelných segmentů,
- reconnect a recovery strategie,
- finální transcript po ukončení,
- krátkodobé credentials nebo secure relay.

B2 nemusí být první implementace, ale návrh s ní musí počítat.

## AI processing

Všechny processing varianty posílají transcript do AI API.

Výchozí provider:

- OpenAI API
- volitelně Gemini API v placeném server-side režimu

Provider požadavek:

- API vstupy a výstupy nesmí být defaultně používány pro trénování modelů.
- Před implementací je nutné ověřit aktuální data/privacy policy.
- Žádné provider opt-in sdílení dat nesmí být zapnuté.

Typy výstupů:

- shrnutí,
- úkoly,
- meeting minutes,
- strukturovaná JSON extrakce,
- CRM poznámka,
- follow-up e-mail,
- vlastní prompt.

## Bezpečnostní požadavky

- RLS na všech tabulkách s uživatelskými daty.
- Private bucket pro audio.
- User isolation podle `user_id`.
- API keys jen server-side.
- Žádné celé transcripty v logách.
- Audit log pouze pro bezpečná metadata.
- Uživatel musí umět smazat audio, transcript i AI output.
- Signed URLs mají být krátkodobé.
- GDPR-aware návrh.

## První budoucí implementační bloky

1. Supabase schema, RLS a private storage bucket.
2. Authenticated upload audio souboru přes signed upload URL.
3. Browser recording přes MediaRecorder.
4. Soniox async transcription integrace.
5. AI processing engine přes provider adapter, výchozí OpenAI API a volitelný Gemini API.
6. Prompt templates a strukturované AI výstupy.
7. Audit, mazání a retence.
8. Realtime transcription připravená jako oddělený modul.

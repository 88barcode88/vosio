# Decision: Target Architecture

## Rozhodnutí

Projekt se navrhuje jako robustní Next.js PWA na Vercelu se Supabase jako auth, databází a storage vrstvou, Soniox jako speech-to-text providerem, OpenAI API jako výchozím AI processing providerem a Gemini API jako volitelným providerem přes stejný adapter.

## Důvody

- Jeden webový kód pokryje mobil i PC.
- Supabase poskytuje auth, Postgres, RLS a private storage v jednom stacku.
- Audio soubory se nemají posílat přes Vercel API routes, ale přímo do storage.
- Přepis a AI zpracování mohou trvat dlouho, proto návrh počítá s job/worker vrstvou.
- OpenAI API je výchozí AI provider, protože požadavek projektu je používat API režim, který defaultně nepoužívá zákaznická data k tréninku modelů. Gemini může být volitelný provider jen v placeném API režimu s odpovídající server-side konfigurací. Před přidáním nebo změnou providera se musí ověřit aktuální policy.

## Důsledky

- Datový model musí od začátku obsahovat job tabulky a stavové hodnoty.
- Realtime přepis je cílová schopnost, i když první implementace může začít standardním nahráváním.
- Provider integrace se mají psát přes adapter vrstvy.
- Security a privacy pravidla nejsou pozdější dodatek, ale součást základního návrhu.

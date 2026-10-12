# Veřejný release checklist

Veřejná aplikace používá samostatnou veřejnou Git historii. Produktový kód se srovnává s ověřeným vývojovým source snapshotem; veřejné návody, konfigurace pro vlastní instalaci, správně zakódovaná původní baseline a univerzální plugin zůstávají veřejné variantě vlastní. Privátní adresy, účty, klíče, provozní receipts ani lokální cesty se nepublikují.

## Zdrojový kandidát

- Porovnat celou aplikaci, dependency lock, Edge Functions, testy a migrační řetězec; každou záměrnou odchylku zaznamenat.
- Zachovat staré veřejné migrační bytes, přidávat pouze chybějící forwards a nepřepisovat související privátní checkout.
- Aktualizovat architekturu, API, gotchas, databázový návod, release metadata a obecný MCP setup.
- Plugin musí být společný a bez přednastaveného targetu. Běžný uživatel dodává webovou adresu, nikoli owner secrets.
- Název/description PR musí popisovat kompletní konečný diff, ne dřívější plugin-only rozsah.

## Ověření před publikací

- Aktuální typecheck, lint, unit suite a produkční build; žádné oslabení gate nebo vypnutí secret-scanu.
- Produkční dependency audit bez high/critical nálezů.
- `npm run check:mcp`: přesný build sdíleného grafu a Deno check/test.
- Nová disposable PostgreSQL databáze: celý migrační řetězec, reálné role/RLS a potřebné SQL/concurrency kontrakty. Odděleně prověřit upgrade z předchozí veřejné chain.
- Inert browser fixture kontroly nových sharing/invitation/capture/checklist/recovery UI na desktopu a mobilu; nejde o test skutečného poskytovatele.
- Jedna nezávislá revize celého konečného diffu před vydáním velké změny. Po materiálních opravách stejný reviewer prověří opravný diff.
- Finální runtime state musí odpovídat kontrolám; docs-only změny nepřepisují platnou runtime evidenci.

## Publikace a externí instalace

Před aplikací automatic-timeline migration na existující cílovou databázi spusťte přesný read-only duplicate preflight:

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

Live apply blocked pending preflight: výsledkem musí být nula řádků. Jakákoli duplicita vyžaduje lineage review; blind dedup ani automatické mazání výstupů nejsou povolené.

- Před pushem ověřit remote, base, branch, commits, full diff a samostatné uncommitted změny. Připravit neprázdný PR title/body a ověřit přístup k GitHub PR API.
- Po autorizovaném push aktualizovat/vytvořit PR a ověřit URL, HEAD a skutečné checks. Source publication, merge, release tag a deploy jsou oddělené stavy.
- Zveřejnění migračních souborů neaplikuje změny na žádný target. Správce existujícího targetu nejprve ověří schema/ledger, zálohu, aktivní work a kompatibilní rollout.
- Vlastní deploy používá své env, SMTP/Auth, Storage, OAuth confidential klienta a secrets. MCP i retenční worker se aktivují výslovně; scheduler se nevytváří automaticky.
- Osobní OAuth, druhý účet, refresh/revoke, fyzické Storage a skutečný Soniox/AI běh jsou samostatná per-target akceptace. Lokální test ani CI jejich úspěch nepotvrzuje.

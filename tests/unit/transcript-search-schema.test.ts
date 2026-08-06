import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTranscriptSearchChunks } from "@/lib/transcripts/search-chunks";

type AccessStatement = {
  grantees: string[];
  kind: "grant" | "revoke";
  privileges: string[];
};

type FunctionAccessStatement = AccessStatement & {
  signature: string;
};

type PolicyDefinition = {
  command: string;
  conditions: string;
  name: string;
  roles: string[];
};

const migrationName = "20260804130000_add_transcript_fulltext_search.sql";
const migrationPath = join(process.cwd(), "supabase", "migrations", migrationName);
const baselineMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260617000000_initial_schema.sql"),
  "utf8"
);
const organizationMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804110000_add_recording_organization.sql"),
  "utf8"
);
const searchMigration = readFileSync(migrationPath, "utf8");
const chunkTablePattern = "public\\.transcript_search_chunks";
const searchSignature = "public.search_own_recordings_v1(text,uuid,uuid,uuid,uuid[],integer,integer)";
const replaceSignature = "public.replace_transcript_search_chunks_v1(uuid,jsonb)";
const refreshSignature = "public.refresh_transcript_search_fallback_v1()";

const expectedChunkAccess: AccessStatement[] = [
  { grantees: ["anon", "authenticated", "public"], kind: "revoke", privileges: ["all"] },
  { grantees: ["authenticated"], kind: "grant", privileges: ["select"] },
  { grantees: ["service_role"], kind: "grant", privileges: ["all"] }
];
const expectedFunctionAccess: FunctionAccessStatement[] = [
  {
    grantees: ["anon", "public"],
    kind: "revoke",
    privileges: ["all"],
    signature: searchSignature
  },
  {
    grantees: ["authenticated"],
    kind: "grant",
    privileges: ["execute"],
    signature: searchSignature
  },
  {
    grantees: ["anon", "authenticated", "public"],
    kind: "revoke",
    privileges: ["all"],
    signature: replaceSignature
  },
  {
    grantees: ["service_role"],
    kind: "grant",
    privileges: ["execute"],
    signature: replaceSignature
  },
  {
    grantees: ["anon", "authenticated", "public"],
    kind: "revoke",
    privileges: ["all"],
    signature: refreshSignature
  }
];
const expectedPolicies: PolicyDefinition[] = [
  {
    command: "select",
    conditions: "using ((select auth.uid()) = user_id)",
    name: "transcript search chunks select own",
    roles: ["authenticated"]
  }
];

// stripSqlComments removes comments so security checks cannot be satisfied by inert SQL.
function stripSqlComments(sql: string) {
  return sql
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

// normalizeSql canonicalizes simple identifiers and whitespace for source contracts.
function normalizeSql(sql: string) {
  return stripSqlComments(sql)
    .toLowerCase()
    .replace(/"([a-z_][a-z0-9_$]*)"/g, "$1")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

// sortAccessStatements makes parsed ACL comparisons independent of SQL statement order.
function sortAccessStatements<T extends AccessStatement>(statements: T[]) {
  return statements.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

// parseChunkAccessStatements enumerates every ACL statement targeting the chunk table.
function parseChunkAccessStatements(sql: string): AccessStatement[] {
  const pattern = new RegExp(
    `\\b(grant|revoke)\\s+([^;]+?)\\s+on\\s+(?:table\\s+)?${chunkTablePattern}\\s+(?:to|from)\\s+([^;]+);`,
    "g"
  );

  return sortAccessStatements(Array.from(normalizeSql(sql).matchAll(pattern), (match) => ({
    grantees: match[3].split(",").map((value) => value.trim()).sort(),
    kind: match[1] as AccessStatement["kind"],
    privileges: match[2].split(",").map((value) => value.trim()).sort()
  })));
}

// parseFunctionAccessStatements enumerates ACL statements for the three search functions.
function parseFunctionAccessStatements(sql: string): FunctionAccessStatement[] {
  const signatures = [searchSignature, replaceSignature, refreshSignature]
    .map((signature) => signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(
    `\\b(grant|revoke)\\s+([^;]+?)\\s+on\\s+function\\s+(${signatures})\\s+(?:to|from)\\s+([^;]+);`,
    "g"
  );

  return sortAccessStatements(Array.from(normalizeSql(sql).matchAll(pattern), (match) => ({
    grantees: match[4].split(",").map((value) => value.trim()).sort(),
    kind: match[1] as AccessStatement["kind"],
    privileges: match[2].split(",").map((value) => value.trim()).sort(),
    signature: match[3]
  })));
}

// parseChunkPolicies enumerates the complete policy boundary on transcript_search_chunks.
function parseChunkPolicies(sql: string): PolicyDefinition[] {
  const pattern = new RegExp(
    `\\bcreate\\s+policy\\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\\s+on\\s+${chunkTablePattern}\\s+([^;]+);`,
    "g"
  );

  return Array.from(normalizeSql(sql).matchAll(pattern), (match) => {
    const definition = match[3];
    const command = definition.match(/\bfor\s+(select|insert|update|delete|all)\b/)?.[1] ?? "missing";
    const roles = definition
      .match(/\bto\s+(.+?)(?=\s+using\b|\s+with\s+check\b|$)/)?.[1]
      .split(",")
      .map((value) => value.trim())
      .sort() ?? [];
    const conditions = definition.match(/\b(using\s+.+|with\s+check\s+.+)$/)?.[1] ?? "";

    return { command, conditions, name: match[1] ?? match[2], roles };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

// findForbiddenSecurityStatements detects broad or destructive mutations in the search migration.
function findForbiddenSecurityStatements(sql: string) {
  const normalized = normalizeSql(sql);
  const statements = normalized.split(";").map((statement) => statement.trim()).filter(Boolean);
  const targetFunctionPattern = /(search_own_recordings_v1|replace_transcript_search_chunks_v1|refresh_transcript_search_fallback_v1)/;

  return statements.filter((statement) =>
    /^alter default privileges\b/.test(statement)
    || /^grant\s+.+\s+on\s+all\s+tables\s+in\s+schema\s+public\b/.test(statement)
    || /^grant\s+.+\s+on\s+schema\s+public\b/.test(statement)
    || /^alter policy\b/.test(statement) && statement.includes("transcript_search_chunks")
    || /^drop policy\b/.test(statement) && statement.includes("transcript_search_chunks")
    || /^drop table\b/.test(statement) && statement.includes("transcript_search_chunks")
    || /^alter table\b/.test(statement)
      && statement.includes("transcript_search_chunks")
      && /(disable row level security|no force row level security)/.test(statement)
    || /^(alter|drop) (function|routine)\b/.test(statement) && targetFunctionPattern.test(statement)
  );
}

// hasExactSecurityContract verifies table ACL, policy, function ACL and mutation guardrails together.
function hasExactSecurityContract(sql: string) {
  return JSON.stringify(parseChunkAccessStatements(sql)) === JSON.stringify(sortAccessStatements([...expectedChunkAccess]))
    && JSON.stringify(parseChunkPolicies(sql)) === JSON.stringify(expectedPolicies)
    && JSON.stringify(parseFunctionAccessStatements(sql)) === JSON.stringify(sortAccessStatements([...expectedFunctionAccess]))
    && findForbiddenSecurityStatements(sql).length === 0;
}

// hasExactTimestampContract requires independent nullable bounds and matching RPC validation.
function hasExactTimestampContract(sql: string) {
  const normalized = normalizeSql(sql);

  return normalized.includes("start_ms bigint check (start_ms is null or start_ms >= 0)")
    && normalized.includes(
      "end_ms bigint check ( end_ms is null or (end_ms >= 0 and (start_ms is null or end_ms >= start_ms)) )"
    )
    && normalized.includes("raise exception 'invalid transcript search chunk timestamp range'")
    && normalized.includes("(chunk.item->>'start_ms')::numeric < 0")
    && normalized.includes("(chunk.item->>'end_ms')::numeric < 0")
    && normalized.includes(
      "(chunk.item->>'end_ms')::numeric < (chunk.item->>'start_ms')::numeric"
    )
    && !normalized.includes("start_ms and end_ms must both be null");
}

describe("transcript full-text search schema migration", () => {
  it("runs after the baseline, organization and marker migrations", () => {
    const migrationNames = readdirSync(join(process.cwd(), "supabase", "migrations")).sort();

    expect(baselineMigration).toContain("create type public.recording_source_type");
    expect(baselineMigration).toContain("create type public.recording_status");
    expect(baselineMigration).toContain("constraint transcripts_id_user_id_unique unique (id, user_id)");
    expect(organizationMigration).toContain("create table public.recording_clients");
    expect(organizationMigration).toContain("create table public.recording_tag_links");
    expect(migrationNames.indexOf(migrationName)).toBeGreaterThan(
      migrationNames.indexOf("20260804120000_add_recording_markers.sql")
    );
  });

  it("creates owner-safe chunks with independently nullable timestamp bounds", () => {
    const normalized = normalizeSql(searchMigration);

    expect(normalized).toContain(
      "alter table public.transcripts add constraint transcripts_id_recording_id_user_id_unique unique (id,recording_id,user_id)"
    );
    expect(normalized).toContain("create table public.transcript_search_chunks");
    expect(normalized).toContain("primary key (transcript_id,position)");
    expect(normalized).toContain(
      "foreign key (transcript_id,recording_id,user_id) references public.transcripts(id,recording_id,user_id) on delete cascade"
    );
    expect(normalized).toContain("start_ms bigint check (start_ms is null or start_ms >= 0)");
    expect(normalized).toContain(
      "end_ms bigint check ( end_ms is null or (end_ms >= 0 and (start_ms is null or end_ms >= start_ms)) )"
    );
    expect(hasExactTimestampContract(searchMigration)).toBe(true);
    expect(normalized).toContain(
      "search_vector tsvector generated always as ( to_tsvector('simple'::regconfig,coalesce(text,'')) ) stored"
    );
    expect(normalized).toContain(
      "create index transcript_search_chunks_vector_idx on public.transcript_search_chunks using gin (search_vector)"
    );
    expect(normalized).toContain(
      "create index transcripts_user_recording_latest_idx on public.transcripts(user_id,recording_id,created_at desc,id desc)"
    );
  });

  it("adds generated simple vectors and GIN indexes for every metadata source", () => {
    const normalized = normalizeSql(searchMigration);

    for (const [table, source] of [
      ["recordings", "title"],
      ["recording_clients", "name"],
      ["recording_projects", "name"],
      ["recording_folders", "name"],
      ["recording_tags", "name"]
    ]) {
      expect(normalized).toContain(
        `alter table public.${table} add column metadata_search_vector tsvector generated always as ( to_tsvector('simple'::regconfig,coalesce(${source},'')) ) stored`
      );
      expect(normalized).toContain(
        `create index ${table}_metadata_search_idx on public.${table} using gin (metadata_search_vector)`
      );
    }
  });

  it("enforces SELECT-only authenticated access with forced owner RLS", () => {
    const normalized = normalizeSql(searchMigration);

    expect(normalized).toContain("alter table public.transcript_search_chunks enable row level security");
    expect(normalized).toContain("alter table public.transcript_search_chunks force row level security");
    expect(parseChunkAccessStatements(searchMigration)).toEqual(sortAccessStatements([...expectedChunkAccess]));
    expect(parseChunkPolicies(searchMigration)).toEqual(expectedPolicies);
    expect(hasExactSecurityContract(searchMigration)).toBe(true);
  });

  it("defines the exact invoker search signature and plain-text result contract", () => {
    const normalized = normalizeSql(searchMigration);

    expect(normalized).toContain(
      "create or replace function public.search_own_recordings_v1( p_query text,p_client_id uuid default null,p_project_id uuid default null,p_folder_id uuid default null,p_tag_ids uuid[] default '{}'::uuid[],p_limit integer default 25,p_offset integer default 0 )"
    );
    expect(normalized).toContain(
      "returns table ( recording_id uuid,title text,source_type public.recording_source_type,mime_type text,duration_seconds integer,file_size_bytes bigint,status public.recording_status,created_at timestamptz,updated_at timestamptz,client_id uuid,project_id uuid,folder_id uuid,matched_excerpt text,match_start_ms bigint,match_end_ms bigint,total_count bigint ) language sql stable security invoker set search_path = public,pg_temp"
    );
    expect(normalized).not.toMatch(
      /search_own_recordings_v1\([^$]+?security definer/
    );
    expect(normalized).not.toContain("dangerouslysetinnerhtml");
    expect(normalized).toContain("startsel=[[h]],stopsel=[[/h]],maxwords=35,minwords=15");
    expect(normalized).not.toMatch(/\bilike\b/);
  });

  it("searches only owned active recordings and the exact latest transcript", () => {
    const normalized = normalizeSql(searchMigration);

    expect(normalized).toContain("authenticated_user as ( select auth.uid() as user_id )");
    expect(normalized).toContain("au.user_id is not null");
    expect(normalized).toContain("where t.user_id = au.user_id order by t.recording_id,t.created_at desc,t.id desc");
    expect(normalized).toContain(
      "where au.user_id is not null and r.user_id = au.user_id and r.status <> 'deleted'"
    );
    expect(normalized).toContain(
      "join latest_transcripts lt on lt.recording_id = r.id and lt.user_id = r.user_id"
    );
    expect(normalized).toContain(
      "join public.transcript_search_chunks c on c.transcript_id = lt.id and c.recording_id = r.id and c.user_id = r.user_id"
    );
  });

  it("normalizes query and tags, applies ALL-tag filters and indexed candidate ranking", () => {
    const normalized = normalizeSql(searchMigration);

    expect(normalized).toContain(
      "left( regexp_replace(btrim(coalesce(p_query,'')),'\\s+',' ','g'),120 ) as query_text"
    );
    expect(normalized).toContain("websearch_to_tsquery('simple'::regconfig,query_text)");
    expect(normalized).toContain("filter (where requested.tag_id is not null)");
    expect(normalized).toContain("array_agg(distinct requested.tag_id order by requested.tag_id)");
    expect(normalized).toContain(
      "c.search_vector @@ i.ts_query"
    );
    expect(normalized).toContain("r.metadata_search_vector @@ i.ts_query");
    expect(normalized).toContain(
      "count(distinct rtl.tag_id) from public.recording_tag_links rtl where rtl.recording_id = r.id and rtl.user_id = au.user_id and rtl.tag_id = any(tf.tag_ids) ) = cardinality(tf.tag_ids)"
    );
  });

  it("unions transcript and metadata matches, keeps one winner and clamps pagination", () => {
    const normalized = normalizeSql(searchMigration);

    expect(normalized).toContain(
      "all_candidates as ( select * from transcript_candidates union all select * from metadata_candidates )"
    );
    expect(normalized).toContain("row_number() over ( partition by c.recording_id");
    expect(normalized).toContain("select * from ranked where candidate_number = 1");
    expect(normalized).toContain("count(*) over () as total_count");
    expect(normalized).toContain("limit greatest(1,least(coalesce(p_limit,25),50))");
    expect(normalized).toContain("offset greatest(coalesce(p_offset,0),0)");
  });

  it("validates every replacement chunk before atomically deleting old rows", () => {
    const normalized = normalizeSql(searchMigration);
    const validationIndex = normalized.indexOf("raise exception 'invalid transcript search chunk'");
    const duplicateIndex = normalized.indexOf("raise exception 'duplicate transcript search chunk position'");
    const deleteIndex = normalized.indexOf("delete from public.transcript_search_chunks c");

    expect(normalized).toContain(
      "create or replace function public.replace_transcript_search_chunks_v1( p_transcript_id uuid,p_chunks jsonb ) returns void language plpgsql security invoker set search_path = public,pg_temp"
    );
    expect(normalized).toContain("raise exception 'p_chunks must be a json array'");
    expect(normalized).toContain("jsonb_typeof(chunk.item) <> 'object'");
    expect(normalized).toContain("char_length(btrim(chunk.item->>'text')) = 0");
    expect(normalized).toContain("raise exception 'invalid transcript search chunk timestamp range'");
    expect(normalized).toContain("from public.transcripts t where t.id = p_transcript_id for update");
    expect(validationIndex).toBeGreaterThan(-1);
    expect(duplicateIndex).toBeGreaterThan(validationIndex);
    expect(deleteIndex).toBeGreaterThan(duplicateIndex);
    expect(normalized).toContain(
      "insert into public.transcript_search_chunks ( transcript_id,recording_id,user_id,position,start_ms,end_ms,speaker_label,text )"
    );
  });

  it("accepts Task 1 start-only and end-only chunk serialization contracts", () => {
    const startOnly = buildTranscriptSearchChunks({
      rawText: "",
      segments: [{ end_ms: null, speaker: 1, start_ms: 1_200, text: "Start only." }],
      speakers: []
    });
    const endOnly = buildTranscriptSearchChunks({
      rawText: "",
      segments: [{ end_ms: 2_400, speaker: 1, start_ms: null, text: "End only." }],
      speakers: []
    });
    const serialized = [...startOnly, ...endOnly].map((chunk) => ({
      end_ms: chunk.endMs,
      position: chunk.position,
      speaker_label: chunk.speakerLabel,
      start_ms: chunk.startMs,
      text: chunk.text
    }));
    const normalized = normalizeSql(searchMigration);

    expect(serialized).toEqual([
      expect.objectContaining({ end_ms: null, start_ms: 1_200 }),
      expect.objectContaining({ end_ms: 2_400, start_ms: null })
    ]);
    expect(hasExactTimestampContract(searchMigration)).toBe(true);
    expect(normalized).toContain(
      "c.start_ms as match_start_ms,c.end_ms as match_end_ms"
    );
  });

  it("detects weakened independent timestamp checks and reversed-range validation", () => {
    const mutations = [
      searchMigration.replace(
        "start_ms bigint check (start_ms is null or start_ms >= 0),",
        "start_ms bigint,"
      ),
      searchMigration.replace(
        /end_ms bigint check \([\s\S]*?\n {2}\),\n {2}speaker_label text/,
        "end_ms bigint check (end_ms is null or end_ms >= 0),\n  speaker_label text"
      ),
      searchMigration.replace(
        "and (chunk.item->>'end_ms')::numeric < (chunk.item->>'start_ms')::numeric",
        "and false"
      )
    ];

    for (const mutation of mutations) {
      expect(mutation).not.toBe(searchMigration);
      expect(hasExactTimestampContract(mutation)).toBe(false);
    }
  });

  it("installs the transactional fallback trigger before the raw-text backfill", () => {
    const normalized = normalizeSql(searchMigration);
    const triggerIndex = normalized.indexOf("create trigger transcripts_refresh_search_fallback");
    const backfillIndex = normalized.indexOf("select t.id,t.recording_id,t.user_id,1,null,null,null,btrim(t.raw_text)");

    expect(normalized).toContain(
      "create or replace function public.refresh_transcript_search_fallback_v1() returns trigger language plpgsql security definer set search_path = public,pg_temp"
    );
    expect(normalized).toContain(
      "after insert or update of raw_text,segments,speakers on public.transcripts"
    );
    expect(normalized).toContain("where btrim(t.raw_text) <> '' on conflict (transcript_id,position) do nothing");
    expect(triggerIndex).toBeGreaterThan(-1);
    expect(backfillIndex).toBeGreaterThan(triggerIndex);
  });

  it("uses exact function ACLs and rejects unsafe mutation variants", () => {
    expect(parseFunctionAccessStatements(searchMigration)).toEqual(
      sortAccessStatements([...expectedFunctionAccess])
    );

    const mutations = [
      "GRANT INSERT ON public.transcript_search_chunks TO authenticated;",
      "GRANT SELECT ON PUBLIC . TRANSCRIPT_SEARCH_CHUNKS TO anon;",
      "CREATE POLICY \"extra public read\" ON public.transcript_search_chunks FOR SELECT TO PUBLIC USING (true);",
      "ALTER TABLE public.transcript_search_chunks DISABLE ROW LEVEL SECURITY;",
      "ALTER TABLE \"public\" . \"transcript_search_chunks\" NO FORCE ROW LEVEL SECURITY;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;",
      "GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;",
      "GRANT USAGE ON SCHEMA public TO anon;",
      `GRANT EXECUTE ON FUNCTION ${replaceSignature} TO authenticated;`,
      `GRANT EXECUTE ON FUNCTION ${searchSignature} TO PUBLIC;`,
      `ALTER FUNCTION ${searchSignature} SECURITY DEFINER;`,
      `DROP FUNCTION IF EXISTS ${replaceSignature};`,
      "DROP POLICY IF EXISTS \"transcript search chunks select own\" ON public.transcript_search_chunks;",
      "DROP TABLE IF EXISTS public.transcript_search_chunks CASCADE;"
    ];

    for (const mutation of mutations) {
      expect(hasExactSecurityContract(`${searchMigration}\n${mutation}`), mutation).toBe(false);
    }

    const commentsOnly = `${searchMigration}\n-- GRANT SELECT ON public.transcript_search_chunks TO anon;\n/* ALTER TABLE public.transcript_search_chunks DISABLE ROW LEVEL SECURITY; */`;
    expect(hasExactSecurityContract(commentsOnly)).toBe(true);
  });
});

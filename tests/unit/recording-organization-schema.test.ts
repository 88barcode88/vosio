import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type AccessStatement = {
  grantees: string[];
  kind: "grant" | "revoke";
  privileges: string[];
  target: string;
};

type PolicyDefinition = {
  command: string;
  conditions: string;
  name: string;
  roles: string[];
  table: string;
};

const organizationTables = [
  "recording_clients",
  "recording_projects",
  "recording_folders",
  "recording_tags",
  "recording_tag_links"
] as const;

const tableTargets = new Set(organizationTables.map((table) => `public.${table}`));

// stripSqlComments removes comments before security statements are enumerated.
function stripSqlComments(sql: string) {
  return sql
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

// normalizeSql canonicalizes simple quoted identifiers and whitespace variants.
function normalizeSql(sql: string) {
  return stripSqlComments(sql)
    .toLowerCase()
    .replace(/"([a-z_][a-z0-9_$]*)"/g, "$1")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

// parseTableAccessStatements expands combined table ACL statements per organization table.
function parseTableAccessStatements(sql: string): AccessStatement[] {
  const statementPattern = /\b(grant|revoke)\s+([^;]+?)\s+on\s+(?:table\s+)?(.+?)\s+(?:to|from)\s+([^;]+);/g;
  const parsed: AccessStatement[] = [];

  for (const match of normalizeSql(sql).matchAll(statementPattern)) {
    for (const target of match[3].split(",").map((value) => value.trim())) {
      if (!tableTargets.has(target)) {
        continue;
      }

      parsed.push({
        grantees: match[4].split(",").map((value) => value.trim()).sort(),
        kind: match[1] as AccessStatement["kind"],
        privileges: match[2].split(",").map((value) => value.trim()).sort(),
        target
      });
    }
  }

  return parsed.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

// parsePolicies enumerates every policy on an organization table, including unexpected ones.
function parsePolicies(sql: string): PolicyDefinition[] {
  const policyPattern = /\bcreate\s+policy\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s+on\s+(public\.[a-z_][a-z0-9_$]*)\s+([^;]+);/g;
  const parsed: PolicyDefinition[] = [];

  for (const match of normalizeSql(sql).matchAll(policyPattern)) {
    if (!tableTargets.has(match[3])) {
      continue;
    }

    const definition = match[4];
    parsed.push({
      command: definition.match(/\bfor\s+(select|insert|update|delete|all)\b/)?.[1] ?? "missing",
      conditions: definition.match(/\b(using\s+.+|with\s+check\s+.+)$/)?.[1] ?? "",
      name: match[1] ?? match[2],
      roles: definition
        .match(/\bto\s+(.+?)(?=\s+using\b|\s+with\s+check\b|$)/)?.[1]
        .split(",")
        .map((value) => value.trim())
        .sort() ?? [],
      table: match[3]
    });
  }

  return parsed.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

// parseFunctionAccessStatements enumerates execute ACLs for both organization RPC signatures.
function parseFunctionAccessStatements(sql: string): AccessStatement[] {
  const statementPattern = /\b(grant|revoke)\s+([^;]+?)\s+on\s+function\s+(public\.[a-z_][a-z0-9_$]*\s*\([^;]*?\))\s+(?:to|from)\s+([^;]+);/g;

  return Array.from(normalizeSql(sql).matchAll(statementPattern), (match) => ({
    grantees: match[4].split(",").map((value) => value.trim()).sort(),
    kind: match[1] as AccessStatement["kind"],
    privileges: match[2].split(",").map((value) => value.trim()).sort(),
    target: match[3].replace(/\s+/g, "")
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

// findForbiddenSecurityStatements catches broad grants and policy mutations outside the allowlist.
function findForbiddenSecurityStatements(sql: string) {
  return normalizeSql(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => {
      const targetsOrganizationTable = organizationTables.some((table) =>
        statement.includes(`public.${table}`)
      );
      const targetsOrganizationRpc = /\bpublic\.(assign_recording_organization_v1|list_own_recordings_v1)\b/.test(statement);
      const grantsAllPublicTables = /\bgrant\b.+\bon\s+all\s+tables\s+in\s+schema\s+public\b/.test(statement);
      const grantsPublicSchema = /\bgrant\b.+\bon\s+schema\s+public\s+to\s+.*\b(public|anon|authenticated)\b/.test(statement);
      const changesUnsafeDefaults = /\balter\s+default\s+privileges\b/.test(statement)
        && /\bgrant\b.+\bon\s+tables\s+to\s+.*\b(public|anon|authenticated)\b/.test(statement);
      const altersOrganizationPolicy = /\balter\s+policy\b.+\bon\s+(public\.[a-z_][a-z0-9_$]*)\b/.test(statement)
        && targetsOrganizationTable;
      const dropsOrganizationPolicy = /\bdrop\s+policy\b.+\bon\s+(public\.[a-z_][a-z0-9_$]*)\b/.test(statement)
        && targetsOrganizationTable;
      const weakensOrganizationRls = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.[a-z_][a-z0-9_$]*(?:\s+\*)?\s+(disable\s+row\s+level\s+security|no\s+force\s+row\s+level\s+security)\b/.test(statement)
        && targetsOrganizationTable;
      const dropsOrganizationTable = /\bdrop\s+table\b.+\bpublic\.[a-z_][a-z0-9_$]*\b/.test(statement)
        && targetsOrganizationTable;
      const changesOrganizationRpc = /\b(drop|alter)\s+(function|routine)\b/.test(statement)
        && targetsOrganizationRpc;

      return grantsAllPublicTables
        || grantsPublicSchema
        || changesUnsafeDefaults
        || altersOrganizationPolicy
        || dropsOrganizationPolicy
        || weakensOrganizationRls
        || dropsOrganizationTable
        || changesOrganizationRpc;
    });
}

const expectedTableAccess: AccessStatement[] = organizationTables.flatMap((table) => [
  {
    grantees: ["anon", "authenticated", "public"],
    kind: "revoke" as const,
    privileges: ["all"],
    target: `public.${table}`
  },
  {
    grantees: ["authenticated"],
    kind: "grant" as const,
    privileges: ["delete", "insert", "select", "update"],
    target: `public.${table}`
  },
  {
    grantees: ["service_role"],
    kind: "grant" as const,
    privileges: ["all"],
    target: `public.${table}`
  }
]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const expectedPolicies: PolicyDefinition[] = organizationTables.flatMap((table) => {
  const policyPrefix = table.replaceAll("_", " ");
  return [
    {
      command: "delete",
      conditions: "using ((select auth.uid()) = user_id)",
      name: `${policyPrefix} delete own`,
      roles: ["authenticated"],
      table: `public.${table}`
    },
    {
      command: "insert",
      conditions: "with check ((select auth.uid()) = user_id)",
      name: `${policyPrefix} insert own`,
      roles: ["authenticated"],
      table: `public.${table}`
    },
    {
      command: "select",
      conditions: "using ((select auth.uid()) = user_id)",
      name: `${policyPrefix} select own`,
      roles: ["authenticated"],
      table: `public.${table}`
    },
    {
      command: "update",
      conditions: "using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)",
      name: `${policyPrefix} update own`,
      roles: ["authenticated"],
      table: `public.${table}`
    }
  ];
}).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const assignSignature = "public.assign_recording_organization_v1(uuid,uuid,uuid,uuid,uuid[])";
const listSignature = "public.list_own_recordings_v1(uuid,uuid,uuid,uuid[],timestamptz,uuid,integer)";
const expectedFunctionAccess: AccessStatement[] = [assignSignature, listSignature].flatMap((target) => [
  {
    grantees: ["anon", "public"],
    kind: "revoke" as const,
    privileges: ["all"],
    target
  },
  {
    grantees: ["authenticated"],
    kind: "grant" as const,
    privileges: ["execute"],
    target
  }
]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

// hasExactOrganizationSecurityContract rejects missing, changed and additional security statements.
function hasExactOrganizationSecurityContract(sql: string) {
  return JSON.stringify(parseTableAccessStatements(sql)) === JSON.stringify(expectedTableAccess)
    && JSON.stringify(parsePolicies(sql)) === JSON.stringify(expectedPolicies)
    && JSON.stringify(parseFunctionAccessStatements(sql)) === JSON.stringify(expectedFunctionAccess)
    && findForbiddenSecurityStatements(sql).length === 0;
}

// hasDeferredClientDeleteContract preserves client blocking without breaking auth-user cascades.
function hasDeferredClientDeleteContract(sql: string) {
  const normalized = normalizeSql(sql);
  const deferredReferences = normalized.match(
    /foreign key \(client_id, user_id\) references public\.recording_clients\(id, user_id\) on delete no action deferrable initially deferred/g
  ) ?? [];

  return deferredReferences.length === 2
    && !/references public\.recording_clients\(id, user_id\) on delete restrict/.test(normalized);
}

const baselinePath = join(process.cwd(), "supabase", "migrations", "20260617000000_initial_schema.sql");
const migrationPath = join(process.cwd(), "supabase", "migrations", "20260804110000_add_recording_organization.sql");
const baselineMigration = readFileSync(baselinePath, "utf8");
const organizationMigration = readFileSync(migrationPath, "utf8");

describe("recording organization schema migration", () => {
  it("fits between the existing forward migrations without baseline name collisions", () => {
    const migrationNames = readdirSync(join(process.cwd(), "supabase", "migrations")).sort();
    const previousMigrations = migrationNames
      .filter((name) => name < "20260804110000_add_recording_organization.sql")
      .map((name) => readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8"))
      .join("\n");

    expect(migrationNames.indexOf("20260804100000_add_evidence_locations.sql"))
      .toBeLessThan(migrationNames.indexOf("20260804110000_add_recording_organization.sql"));
    expect(migrationNames.indexOf("20260804110000_add_recording_organization.sql"))
      .toBeLessThan(migrationNames.indexOf("20260804120000_add_recording_markers.sql"));
    expect(baselineMigration.replace(/\s+/g, " ")).toContain(
      "constraint recordings_id_user_id_unique unique (id, user_id)"
    );
    expect(baselineMigration.replace(/\s+/g, " ")).toContain(
      "create or replace function public.set_updated_at() returns trigger"
    );
    for (const table of organizationTables) {
      expect(previousMigrations).not.toMatch(new RegExp(`create\\s+table\\s+public\\.${table}\\b`, "i"));
    }
    expect(previousMigrations).not.toMatch(/add\s+column\s+(client_id|project_id|folder_id)\b/i);
  });

  it("creates owner-safe lookup and tag-link relationships in dependency order", () => {
    const normalized = normalizeSql(organizationMigration);
    const clientsAt = normalized.indexOf("create table public.recording_clients");
    const projectsAt = normalized.indexOf("create table public.recording_projects");
    const alterRecordingsAt = normalized.indexOf("alter table public.recordings");
    const linksAt = normalized.indexOf("create table public.recording_tag_links");

    expect(clientsAt).toBeGreaterThanOrEqual(0);
    expect(projectsAt).toBeGreaterThan(clientsAt);
    expect(alterRecordingsAt).toBeGreaterThan(projectsAt);
    expect(linksAt).toBeGreaterThan(alterRecordingsAt);
    for (const table of organizationTables) {
      const tableBody = organizationMigration.match(
        new RegExp(`create\\s+table\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i")
      )?.[1];

      expect(tableBody, table).toBeDefined();
      expect(normalized).toContain(`create table public.${table}`);
      expect(normalizeSql(tableBody ?? "")).toContain(
        "user_id uuid not null references auth.users(id) on delete cascade"
      );
    }
    expect(normalized.match(/unique \(id, user_id\)/g)).toHaveLength(4);
    expect(normalized).toContain("unique (id, client_id, user_id)");
    expect(normalized).toContain("primary key (recording_id, tag_id)");
    expect(normalized).toContain(
      "foreign key (client_id, user_id) references public.recording_clients(id, user_id) on delete no action deferrable initially deferred"
    );
    expect(normalized).toContain(
      "foreign key (recording_id, user_id) references public.recordings(id, user_id) on delete cascade"
    );
    expect(normalized).toContain(
      "foreign key (tag_id, user_id) references public.recording_tags(id, user_id) on delete cascade"
    );
  });

  it("bounds lookup names and colors and enforces normalized per-owner uniqueness", () => {
    const normalized = normalizeSql(organizationMigration);

    expect(normalized.match(/char_length\(btrim\(name\)\) between 1 and 100/g)).toHaveLength(3);
    expect(normalized.match(/char_length\(btrim\(name\)\) between 1 and 60/g)).toHaveLength(1);
    expect(organizationMigration.match(/color ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/g)).toHaveLength(4);
    expect(normalized).toContain(
      "create unique index recording_projects_user_client_name_ci_uidx on public.recording_projects(user_id, client_id, lower(btrim(name)))"
    );
    for (const table of ["recording_clients", "recording_folders", "recording_tags"]) {
      expect(normalized).toContain(
        `on public.${table}(user_id, lower(btrim(name)))`
      );
    }
  });

  it("keeps recording assignments nullable while enforcing the project-client invariant", () => {
    const normalized = normalizeSql(organizationMigration);

    expect(normalized).toContain(
      "add column client_id uuid, add column project_id uuid, add column folder_id uuid"
    );
    expect(normalized).not.toMatch(/add column (client_id|project_id|folder_id) uuid not null/);
    expect(normalized).toContain(
      "constraint recordings_project_requires_client_check check (project_id is null or client_id is not null)"
    );
    expect(normalized).toContain(
      "foreign key (project_id, client_id, user_id) references public.recording_projects(id, client_id, user_id) on delete set null (project_id)"
    );
    expect(normalized).toContain(
      "foreign key (folder_id, user_id) references public.recording_folders(id, user_id) on delete set null (folder_id)"
    );
    expect(normalized).toContain(
      "foreign key (client_id, user_id) references public.recording_clients(id, user_id) on delete no action deferrable initially deferred"
    );
    expect(normalized).not.toContain("on delete set null (client_id");
  });

  it("defers both client references so account cascades can remove child rows before commit", () => {
    expect(hasDeferredClientDeleteContract(organizationMigration)).toBe(true);
    expect(organizationMigration).toContain(
      "RELEASE GATE: verify the full auth.users account cascade in a disposable database before applying this migration live."
    );

    const restrictiveMutation = organizationMigration.replace(
      "on delete no action deferrable initially deferred",
      "on delete restrict"
    );
    const immediateMutation = organizationMigration.replace(
      "on delete no action deferrable initially deferred",
      "on delete no action"
    );

    expect(hasDeferredClientDeleteContract(restrictiveMutation)).toBe(false);
    expect(hasDeferredClientDeleteContract(immediateMutation)).toBe(false);
  });

  it("adds normalized-name indexes, recording filters, tag lookup and update triggers", () => {
    const normalized = normalizeSql(organizationMigration);
    for (const index of [
      "recording_clients_user_name_ci_uidx",
      "recording_projects_user_client_name_ci_uidx",
      "recording_folders_user_name_ci_uidx",
      "recording_tags_user_name_ci_uidx",
      "recordings_user_client_created_idx",
      "recordings_user_project_created_idx",
      "recordings_user_folder_created_idx",
      "recording_tag_links_user_tag_recording_idx"
    ]) {
      expect(normalized).toContain(`create ${index.includes("uidx") ? "unique " : ""}index ${index}`);
    }
    for (const table of organizationTables.slice(0, 4)) {
      expect(normalized).toContain(
        `create trigger ${table}_set_updated_at before update on public.${table} for each row execute function public.set_updated_at()`
      );
    }
  });

  it("uses an exact owner-only table ACL and policy allowlist", () => {
    const normalized = normalizeSql(organizationMigration);
    for (const table of organizationTables) {
      expect(normalized).toContain(`alter table public.${table} enable row level security`);
      expect(normalized).toContain(`alter table public.${table} force row level security`);
    }
    expect(parseTableAccessStatements(organizationMigration)).toEqual(expectedTableAccess);
    expect(parsePolicies(organizationMigration)).toEqual(expectedPolicies);
    expect(findForbiddenSecurityStatements(organizationMigration)).toEqual([]);
    expect(hasExactOrganizationSecurityContract(organizationMigration)).toBe(true);
  });

  it("detects extra public table access and permissive policies across SQL variants", () => {
    const tableReferences = (table: string) => [
      `public.${table}`,
      `PUBLIC.${table.toUpperCase()}`,
      `public . ${table}`,
      `public /* block comment */ . ${table}`,
      `public -- line comment\n . ${table}`,
      `"public"."${table}"`
    ];

    for (const table of organizationTables) {
      for (const tableReference of tableReferences(table)) {
        for (const grantee of ["ANON", "PUBLIC"]) {
          const mutated = `${organizationMigration}\nGRANT SELECT ON ${tableReference} TO ${grantee};`;
          expect(hasExactOrganizationSecurityContract(mutated)).toBe(false);
        }

        const mutated = `${organizationMigration}\nCREATE POLICY "unexpected public read" ON ${tableReference} AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);`;
        expect(hasExactOrganizationSecurityContract(mutated)).toBe(false);
      }
    }

    const commentsOnly = `${organizationMigration}\n-- GRANT SELECT ON public.recording_clients TO public;\n/* CREATE POLICY "fake" ON public.recording_tags FOR SELECT TO public USING (true); */`;
    expect(parseTableAccessStatements(commentsOnly)).toEqual(expectedTableAccess);
    expect(parsePolicies(commentsOnly)).toEqual(expectedPolicies);
    expect(hasExactOrganizationSecurityContract(commentsOnly)).toBe(true);
  });

  it("rejects broad grants, unsafe default privileges and every organization policy alteration", () => {
    const broadGrantMutations = [
      "GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;",
      "grant all on all tables in schema PUBLIC to AUTHENTICATED;",
      "GRANT SELECT ON ALL /* scope */ TABLES IN SCHEMA \"public\" TO PUBLIC;",
      "GRANT SELECT ON ALL TABLES IN -- schema target\n SCHEMA public TO service_role;",
      "GRANT USAGE ON SCHEMA public TO authenticated;",
      "GRANT USAGE ON SCHEMA \"public\" TO \"anon\";"
    ];
    const defaultPrivilegeMutations = [
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;",
      "alter default privileges grant all on tables to PUBLIC;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA \"public\" GRANT SELECT ON TABLES TO \"authenticated\";",
      "ALTER /* defaults */ DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO public, anon;"
    ];

    for (const mutation of [...broadGrantMutations, ...defaultPrivilegeMutations]) {
      const mutated = `${organizationMigration}\n${mutation}`;
      expect(findForbiddenSecurityStatements(mutated), mutation).not.toEqual([]);
      expect(hasExactOrganizationSecurityContract(mutated), mutation).toBe(false);
    }

    for (const table of organizationTables) {
      const tableReferences = [
        `public.${table}`,
        `PUBLIC . ${table.toUpperCase()}`,
        `"public"."${table}"`,
        `public /* policy table */ . ${table}`,
        `public -- policy table\n . ${table}`
      ];

      for (const tableReference of tableReferences) {
        const mutation = `ALTER POLICY "recording ${table} select own" ON ${tableReference} TO PUBLIC USING (true);`;
        const mutated = `${organizationMigration}\n${mutation}`;
        expect(findForbiddenSecurityStatements(mutated), mutation).not.toEqual([]);
        expect(hasExactOrganizationSecurityContract(mutated), mutation).toBe(false);
      }
    }
  });

  it("rejects policy removal and RLS weakening on every organization table", () => {
    for (const table of organizationTables) {
      const tableReferences = [
        `public.${table}`,
        `PUBLIC . ${table.toUpperCase()}`,
        `"public"."${table}"`,
        `public /* controlled table */ . ${table}`,
        `public -- controlled table\n . ${table}`
      ];

      for (const tableReference of tableReferences) {
        const mutations = [
          `DROP POLICY "recording policy" ON ${tableReference};`,
          `drop policy if exists "recording policy" on ${tableReference} cascade;`,
          `ALTER TABLE ${tableReference} DISABLE ROW LEVEL SECURITY;`,
          `alter table if exists only ${tableReference} no force row level security;`
        ];

        for (const mutation of mutations) {
          const mutated = `${organizationMigration}\n${mutation}`;
          expect(findForbiddenSecurityStatements(mutated), mutation).not.toEqual([]);
          expect(hasExactOrganizationSecurityContract(mutated), mutation).toBe(false);
        }
      }
    }
  });

  it("rejects simple destructive organization table and RPC mutations", () => {
    const mutations = [
      "DROP TABLE IF EXISTS public.recording_tags CASCADE;",
      "drop table \"public\" . \"recording_tag_links\";",
      `DROP FUNCTION IF EXISTS ${assignSignature};`,
      `ALTER FUNCTION ${listSignature} SECURITY DEFINER;`,
      `DROP ROUTINE ${listSignature};`
    ];

    for (const mutation of mutations) {
      const mutated = `${organizationMigration}\n${mutation}`;
      expect(findForbiddenSecurityStatements(mutated), mutation).not.toEqual([]);
      expect(hasExactOrganizationSecurityContract(mutated), mutation).toBe(false);
    }
  });

  it("defines transactional owner-safe assignment with deterministic tag normalization", () => {
    const normalized = normalizeSql(organizationMigration);

    expect(normalized).toContain(
      "create or replace function public.assign_recording_organization_v1( p_recording_id uuid, p_client_id uuid, p_project_id uuid, p_folder_id uuid, p_tag_ids uuid[] default '{}'::uuid[] ) returns void language plpgsql security invoker set search_path = public, pg_temp"
    );
    expect(normalized).toContain("current_user_id uuid := (select auth.uid())");
    expect(normalized).toContain(
      "where r.id = p_recording_id and r.user_id = current_user_id and r.status <> 'deleted' for update"
    );
    expect(normalized).toContain("raise exception 'tag ids cannot contain null'");
    expect(normalized).toContain(
      "array_agg(distinct requested.tag_id order by requested.tag_id)"
    );
    expect(normalized).toContain(
      "update public.recordings set client_id = p_client_id, project_id = p_project_id, folder_id = p_folder_id where id = p_recording_id and user_id = current_user_id"
    );
    expect(normalized).toContain(
      "delete from public.recording_tag_links where recording_id = p_recording_id and user_id = current_user_id"
    );
    expect(normalized).toContain(
      "insert into public.recording_tag_links(recording_id, tag_id, user_id) select p_recording_id, requested.tag_id, current_user_id from unnest(normalized_tag_ids) as requested(tag_id)"
    );
  });

  it("defines an owner/RLS-bound ALL-tag list with safe empty filters and pagination", () => {
    const normalized = normalizeSql(organizationMigration);

    expect(normalized).toContain(
      "create or replace function public.list_own_recordings_v1( p_client_id uuid default null, p_project_id uuid default null, p_folder_id uuid default null, p_tag_ids uuid[] default '{}'::uuid[], p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 100 ) returns setof public.recordings language sql stable security invoker set search_path = public, pg_temp"
    );
    expect(normalized).toContain("from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id)");
    expect(normalized).toContain("filter (where requested.tag_id is not null)");
    expect(normalized).toContain("where r.user_id = (select auth.uid()) and r.status <> 'deleted'");
    expect(normalized).toContain(
      "count(distinct rtl.tag_id) from public.recording_tag_links rtl where rtl.recording_id = r.id and rtl.user_id = (select auth.uid()) and rtl.tag_id = any(tf.tag_ids) ) = cardinality(tf.tag_ids)"
    );
    expect(normalized).toContain("order by r.created_at desc, r.id desc");
    expect(normalized).toContain(
      "and ( (p_before_created_at is null and p_before_id is null) or ( p_before_created_at is not null and p_before_id is not null and (r.created_at, r.id) < (p_before_created_at, p_before_id) ) )"
    );
    expect(normalized).toContain("limit greatest(1, least(coalesce(p_limit, 100), 1000))");
    expect(normalized).not.toContain("p_offset");
  });

  it("uses exact invoker RPC signatures and execute grants", () => {
    const normalized = normalizeSql(organizationMigration);

    expect(normalized).not.toContain("security definer");
    expect(normalized.match(/security invoker/g)).toHaveLength(2);
    expect(normalized.match(/set search_path = public, pg_temp/g)).toHaveLength(2);
    expect(parseFunctionAccessStatements(organizationMigration)).toEqual(expectedFunctionAccess);
    expect(hasExactOrganizationSecurityContract(organizationMigration)).toBe(true);

    for (const signature of [assignSignature, listSignature]) {
      for (const reference of [signature, signature.toUpperCase(), `"public".${signature.slice(7)}`]) {
        const mutated = `${organizationMigration}\nGRANT EXECUTE ON FUNCTION ${reference} TO PUBLIC;`;
        expect(hasExactOrganizationSecurityContract(mutated)).toBe(false);
      }
    }
  });

  it("keeps source-level SQL delimiters and function bodies structurally balanced", () => {
    expect(organizationMigration.match(/\$assign\$/g)).toHaveLength(2);
    expect(organizationMigration.match(/\$list\$/g)).toHaveLength(2);
    expect(organizationMigration.match(/create or replace function/gi)).toHaveLength(2);
    expect(organizationMigration.match(/returns void/gi)).toHaveLength(1);
    expect(organizationMigration.match(/returns setof public\.recordings/gi)).toHaveLength(1);
  });
});

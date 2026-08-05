import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type MarkerAccessStatement = {
  grantees: string[];
  kind: "grant" | "revoke";
  privileges: string[];
};

type MarkerPolicy = {
  command: string;
  conditions: string;
  name: string;
  roles: string[];
};

const markerTablePattern = "public\\.recording_markers";
const expectedMarkerAccessStatements: MarkerAccessStatement[] = [
  {
    grantees: ["anon", "authenticated", "public"],
    kind: "revoke",
    privileges: ["all"]
  },
  {
    grantees: ["authenticated"],
    kind: "grant",
    privileges: ["delete", "insert", "select", "update"]
  },
  {
    grantees: ["service_role"],
    kind: "grant",
    privileges: ["all"]
  }
];
const expectedMarkerPolicies: MarkerPolicy[] = [
  {
    command: "delete",
    conditions: "using ((select auth.uid()) = user_id)",
    name: "recording markers delete own",
    roles: ["authenticated"]
  },
  {
    command: "insert",
    conditions: "with check ((select auth.uid()) = user_id)",
    name: "recording markers insert own",
    roles: ["authenticated"]
  },
  {
    command: "select",
    conditions: "using ((select auth.uid()) = user_id)",
    name: "recording markers select own",
    roles: ["authenticated"]
  },
  {
    command: "update",
    conditions: "using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)",
    name: "recording markers update own",
    roles: ["authenticated"]
  }
];

// stripSqlComments removes line and block comments before token normalization.
function stripSqlComments(sql: string) {
  return sql
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

// normalizeSql canonicalizes simple quoted identifiers and qualified table spacing.
function normalizeSql(sql: string) {
  return stripSqlComments(sql)
    .toLowerCase()
    .replace(/"([a-z_][a-z0-9_$]*)"/g, "$1")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

// parseMarkerAccessStatements enumerates every grant or revoke targeting recording_markers.
function parseMarkerAccessStatements(sql: string): MarkerAccessStatement[] {
  const normalizedSql = normalizeSql(sql);
  const statementPattern = new RegExp(
    `\\b(grant|revoke)\\s+([^;]+?)\\s+on\\s+(?:table\\s+)?${markerTablePattern}\\s+(?:to|from)\\s+([^;]+);`,
    "g"
  );

  return Array.from(normalizedSql.matchAll(statementPattern), (match) => ({
    grantees: match[3].split(",").map((value) => value.trim()).sort(),
    kind: match[1] as MarkerAccessStatement["kind"],
    privileges: match[2].split(",").map((value) => value.trim()).sort()
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

// parseMarkerPolicies enumerates policy identity, command, roles and the complete condition tail.
function parseMarkerPolicies(sql: string): MarkerPolicy[] {
  const normalizedSql = normalizeSql(sql);
  const policyPattern = new RegExp(
    `\\bcreate\\s+policy\\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\\s+on\\s+${markerTablePattern}\\s+([^;]+);`,
    "g"
  );

  return Array.from(normalizedSql.matchAll(policyPattern), (match) => {
    const definition = match[3];
    const command = definition.match(/\bfor\s+(select|insert|update|delete|all)\b/)?.[1] ?? "missing";
    const roles = definition
      .match(/\bto\s+(.+?)(?=\s+using\b|\s+with\s+check\b|$)/)?.[1]
      .split(",")
      .map((value) => value.trim())
      .sort() ?? [];
    const conditions = definition.match(/\b(using\s+.+|with\s+check\s+.+)$/)?.[1] ?? "";

    return {
      command,
      conditions,
      name: match[1] ?? match[2],
      roles
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

// hasExactMarkerSecurityContract rejects missing or additional access statements and policies.
function hasExactMarkerSecurityContract(sql: string) {
  return JSON.stringify(parseMarkerAccessStatements(sql)) === JSON.stringify(expectedMarkerAccessStatements)
    && JSON.stringify(parseMarkerPolicies(sql)) === JSON.stringify(expectedMarkerPolicies);
}

const baselineMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260617000000_initial_schema.sql"),
  "utf8"
);
const markerMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804120000_add_recording_markers.sql"),
  "utf8"
);

describe("recording markers schema migration", () => {
  it("uses the existing recording ownership key and updated-at trigger contract", () => {
    const normalizedBaseline = baselineMigration.replace(/\s+/g, " ");
    const normalizedMigration = markerMigration.replace(/\s+/g, " ");

    expect(normalizedBaseline).toContain(
      "constraint recordings_id_user_id_unique unique (id, user_id)"
    );
    expect(normalizedBaseline).toContain(
      "create or replace function public.set_updated_at() returns trigger"
    );
    expect(markerMigration).toContain("create table public.recording_markers");
    expect(normalizedMigration).toContain(
      "foreign key (recording_id, user_id) references public.recordings(id, user_id) on delete cascade"
    );
  });

  it("enforces retry idempotency and marker value bounds", () => {
    const normalizedMigration = markerMigration.replace(/\s+/g, " ");

    expect(normalizedMigration).toContain("client_marker_id uuid not null");
    expect(normalizedMigration).toContain("unique (user_id, client_marker_id)");
    expect(normalizedMigration).toContain(
      "offset_ms bigint not null check (offset_ms between 0 and 86400000)"
    );
    expect(normalizedMigration).toContain(
      "marker_type text not null default 'important' check (marker_type in ('important', 'task', 'decision', 'follow_up'))"
    );
    expect(normalizedMigration).toContain(
      "note text check (note is null or char_length(note) <= 280)"
    );
  });

  it("indexes the recording timeline and refreshes updated_at", () => {
    const normalizedMigration = markerMigration.replace(/\s+/g, " ");

    expect(normalizedMigration).toContain(
      "created_at timestamptz not null default now()"
    );
    expect(normalizedMigration).toContain(
      "updated_at timestamptz not null default now()"
    );
    expect(normalizedMigration).toContain(
      "create index recording_markers_recording_offset_idx on public.recording_markers(user_id, recording_id, offset_ms, id)"
    );
    expect(normalizedMigration).toContain(
      "create trigger recording_markers_set_updated_at before update on public.recording_markers for each row execute function public.set_updated_at()"
    );
  });

  it("enforces the complete owner-only RLS and grant boundary", () => {
    const normalizedMigration = markerMigration.replace(/\s+/g, " ");

    expect(normalizedMigration).toContain(
      "alter table public.recording_markers enable row level security"
    );
    expect(normalizedMigration).toContain(
      "alter table public.recording_markers force row level security"
    );

    const accessStatements = parseMarkerAccessStatements(markerMigration);
    expect(accessStatements).toEqual(expectedMarkerAccessStatements);

    const unsafePublicGrants = accessStatements.filter((statement) =>
      statement.kind === "grant"
      && statement.grantees.some((grantee) => grantee === "anon" || grantee === "public")
      && statement.privileges.some((privilege) =>
        privilege === "all" || ["select", "insert", "update", "delete"].includes(privilege)
      )
    );
    expect(unsafePublicGrants).toEqual([]);

    expect(parseMarkerPolicies(markerMigration)).toEqual(expectedMarkerPolicies);
    expect(hasExactMarkerSecurityContract(markerMigration)).toBe(true);
  });

  it("detects extra public access across equivalent marker table references", () => {
    const markerTableReferences = [
      "public.recording_markers",
      "PUBLIC.RECORDING_MARKERS",
      "public . recording_markers",
      "public /* block comment */ . recording_markers",
      "public -- line comment\n . recording_markers",
      '"public"."recording_markers"'
    ];

    for (const tableReference of markerTableReferences) {
      for (const grantee of ["ANON", "PUBLIC"]) {
        const migrationWithUnsafeGrant = `${markerMigration}\nGRANT SELECT ON ${tableReference} TO ${grantee};`;
        const parsedAccess = parseMarkerAccessStatements(migrationWithUnsafeGrant);
        const unsafeGrant = parsedAccess.find((statement) =>
          statement.kind === "grant"
          && statement.grantees.includes(grantee.toLowerCase())
          && statement.privileges.includes("select")
        );

        expect(unsafeGrant, `${tableReference} -> ${grantee}`).toBeDefined();
        expect(
          hasExactMarkerSecurityContract(migrationWithUnsafeGrant),
          `${tableReference} -> ${grantee}`
        ).toBe(false);
      }

      const migrationWithExtraPolicy = `${markerMigration}\nCREATE POLICY "unexpected public read" ON ${tableReference} FOR SELECT TO PUBLIC USING (true);`;
      const parsedPolicies = parseMarkerPolicies(migrationWithExtraPolicy);

      expect(
        parsedPolicies.some((policy) => policy.name === "unexpected public read"),
        tableReference
      ).toBe(true);
      expect(hasExactMarkerSecurityContract(migrationWithExtraPolicy), tableReference).toBe(false);
    }
  });
});

import { z } from "zod";

// One active own connection as returned by mcp_list_own_connections_v1 (extensionId is null for MCP clients).
export const ownConnectionSchema = z.object({
  clientName: z.string(),
  createdAt: z.string(),
  extensionId: z.string().nullish().transform((value) => value ?? null),
  id: z.uuid(),
  scopes: z.array(z.string())
});

export type OwnConnection = z.infer<typeof ownConnectionSchema>;

export type OwnConnectionsResult = { connections: OwnConnection[]; ok: true } | { ok: false };

// Validates the RPC payload into a bounded list of own connections, or null when its shape is unexpected.
export function parseOwnConnections(data: unknown): OwnConnection[] | null {
  const parsed = z.array(ownConnectionSchema).max(50).safeParse(data);
  return parsed.success ? parsed.data : null;
}

// Shortens a 32-letter extension ID to its first eight letters so Chrome and Edge installations stay distinguishable.
export function shortExtensionId(extensionId: string) {
  return `${extensionId.slice(0, 8)}…`;
}

// Formats the pairing timestamp as DD.MM.YYYY in the Czech time zone (stable between server and browser render).
export function formatConnectionDate(value: string) {
  const parts = new Intl.DateTimeFormat("cs-CZ", { day: "2-digit", month: "2-digit", timeZone: "Europe/Prague", year: "numeric" }).formatToParts(new Date(value));
  const part = (type: "day" | "month" | "year") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")}`;
}

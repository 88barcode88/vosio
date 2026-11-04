import type { NextRequest } from "next/server";
import { deleteStructuredItemGroup } from "@/lib/ai/structured-item-group-delete.server";

type RouteContext = {
  params: Promise<{ decisionId: string }>;
};

// Deletes one logical decision group atomically under current recording-manager authority.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { decisionId } = await context.params;
  return deleteStructuredItemGroup("decision", decisionId);
}

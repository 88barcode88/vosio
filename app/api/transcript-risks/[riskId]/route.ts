import type { NextRequest } from "next/server";
import { deleteStructuredItemGroup } from "@/lib/ai/structured-item-group-delete.server";

type RouteContext = {
  params: Promise<{ riskId: string }>;
};

// Deletes one logical risk/blocker group atomically under current recording-manager authority.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { riskId } = await context.params;
  return deleteStructuredItemGroup("risk", riskId);
}

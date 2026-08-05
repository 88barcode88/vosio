import { NextResponse } from "next/server";
import { deleteOrganizationFixture } from "../fixture-store";

const scopePattern = /^[0-9a-f]{11}$/;

// DELETE removes one isolated development-only Playwright scope after its test.
export async function DELETE(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const scope = new URL(request.url).searchParams.get("scope");
  if (!scope || !scopePattern.test(scope)) {
    return NextResponse.json({ error: "Invalid fixture scope" }, { status: 400 });
  }
  deleteOrganizationFixture(scope);
  return NextResponse.json({ ok: true });
}

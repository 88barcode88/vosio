import { NextResponse } from "next/server";
import { validateOrganizationFixtureAccess } from "../development-runtime";
import { deleteOrganizationFixture } from "../fixture-store";

// DELETE removes one isolated development-only Playwright scope after its test.
export async function DELETE(request: Request) {
  const scopes = new URL(request.url).searchParams.getAll("scope");
  const access = validateOrganizationFixtureAccess(
    process.env.NODE_ENV,
    scopes.length === 1 ? scopes[0] : null
  );
  if (!access.ok && access.reason === "environment") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!access.ok) {
    return NextResponse.json({ error: "Invalid fixture scope" }, { status: 400 });
  }
  deleteOrganizationFixture(access.scope);
  return NextResponse.json({ ok: true });
}

import { notFound } from "next/navigation";
import {
  isWorkspaceShellFixtureScope,
  isWorkspaceShellFixtureView,
  WorkspaceShellFixture
} from "./workspace-shell-fixture";

export const dynamic = "force-dynamic";

// WorkspaceShellE2EPage keeps the original query entry point for scoped layout checks.
export default async function WorkspaceShellE2EPage({
  searchParams
}: {
  searchParams: Promise<{ scope?: string; view?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const { scope, view } = await searchParams;
  if (!isWorkspaceShellFixtureScope(scope) || !isWorkspaceShellFixtureView(view)) {
    notFound();
  }

  return <WorkspaceShellFixture scope={scope} view={view} />;
}

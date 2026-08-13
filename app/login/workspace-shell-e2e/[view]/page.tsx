import { notFound } from "next/navigation";
import {
  isWorkspaceShellFixtureScope,
  isWorkspaceShellFixtureView,
  WorkspaceShellFixture
} from "../workspace-shell-fixture";

export const dynamic = "force-dynamic";

// WorkspaceShellViewE2EPage provides pathname-changing fixture targets for real navigation feedback.
export default async function WorkspaceShellViewE2EPage({
  params,
  searchParams
}: {
  params: Promise<{ view?: string }>;
  searchParams: Promise<{ mode?: string | string[]; scope?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const [{ view }, query] = await Promise.all([params, searchParams]);
  const { scope } = query;
  if (!isWorkspaceShellFixtureScope(scope) || !isWorkspaceShellFixtureView(view)) {
    notFound();
  }

  const mode = typeof query.mode === "string" && ["empty", "failure"].includes(query.mode)
    ? query.mode as "empty" | "failure"
    : "populated";

  return <WorkspaceShellFixture scope={scope} trashMode={mode} view={view} />;
}

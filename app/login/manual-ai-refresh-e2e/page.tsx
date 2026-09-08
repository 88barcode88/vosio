import { notFound } from "next/navigation";
import { ManualAiRefreshFixture } from "./manual-ai-refresh-fixture";

export const dynamic = "force-dynamic";

const fixtureScopePattern = /^[0-9a-f]{12}$/;

// ManualAiRefreshE2EPage exposes the real mounted AI provider behind a scoped development-only route.
export default async function ManualAiRefreshE2EPage({
  searchParams
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { scope } = await searchParams;
  if (!scope || !fixtureScopePattern.test(scope)) notFound();

  return <ManualAiRefreshFixture />;
}

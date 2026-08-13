"use server";

const fixtureScopePattern = /^[0-9a-f]{12}$/;

// assertDevelopmentFixtureAction keeps inert Trash actions bound to a valid local fixture scope.
function assertDevelopmentFixtureAction(formData: FormData) {
  const scope = formData.get("fixtureScope");
  if (process.env.NODE_ENV !== "development" || typeof scope !== "string" || !fixtureScopePattern.test(scope)) {
    throw new Error("Fixture is unavailable.");
  }
}

// inertTrashAction simulates a pending successful mutation without database, Storage or network access.
export async function inertTrashAction(formData: FormData): Promise<void> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 650));
}

// rejectTrashAction simulates a sanitized client-action failure without mutating external state.
export async function rejectTrashAction(formData: FormData): Promise<void> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 450));
  throw new Error("fixture-private-trash-failure");
}

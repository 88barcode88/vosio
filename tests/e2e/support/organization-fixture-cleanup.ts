type FixtureCleanupResponse = {
  ok: () => boolean;
  status: () => number;
};

type FixtureCleanupRequest = {
  delete: (url: string) => Promise<FixtureCleanupResponse>;
};

// isConnectionReset limits the retry to the transient socket failure observed under parallel dev load.
function isConnectionReset(error: unknown) {
  return error instanceof Error && /\bECONNRESET\b/u.test(error.message);
}

// cleanupOrganizationFixture removes one idempotent in-memory fixture and retries one connection reset only.
export async function cleanupOrganizationFixture(request: FixtureCleanupRequest, scope: string) {
  const url = `/login/recording-organization-e2e/fixture?scope=${encodeURIComponent(scope)}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await request.delete(url);
      if (!response.ok()) {
        throw new Error(`Organization fixture cleanup failed with HTTP ${response.status()}.`);
      }
      return;
    } catch (error) {
      if (attempt === 0 && isConnectionReset(error)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      throw error;
    }
  }
}

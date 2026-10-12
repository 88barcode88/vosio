export type DurableGenerationScope = { ownerId: string; recordingId: string; generationId: string };

// Use one origin-wide native lock per exact browser generation across captures, resume and discard.
function generationLockName(scope: DurableGenerationScope) {
  return `vosio-durable-generation:${JSON.stringify([scope.ownerId, scope.recordingId, scope.generationId])}`;
}

// Share a native writer lease until its caller's final persistence/promotion settles.
async function acquireWriter(name: string, locks: LockManager) {
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const request = locks.request(name, { mode: "shared" }, async () => {
    acquired();
    await held;
  });
  await Promise.race([ready, request]);
  return async () => { release(); await request; };
}

// Parent custody covers all browser owners/generations of a recording without guessing server-side generation identity.
export async function acquireDurableGenerationWriter(scope: DurableGenerationScope, locks = globalThis.navigator?.locks) {
  if (!locks) return () => {};
  const releaseRecording = await acquireWriter(`vosio-durable-recording:${scope.recordingId}`, locks);
  try {
    const releaseGeneration = await acquireWriter(generationLockName(scope), locks);
    return async () => { try { await releaseGeneration(); } finally { await releaseRecording(); } };
  } catch (error) { await releaseRecording(); throw error; }
}

// Recovery and Trash require immediate exclusive recording custody through their receipt and cleanup.
export async function withDurableRecordingMutation(recordingId: string, mutate: () => Promise<void>, locks = globalThis.navigator?.locks) {
  if (!locks) return false;
  return locks.request(`vosio-durable-recording:${recordingId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await mutate();
    return true;
  });
}

// Serialize writer completion with discard without changing ordinary unsupported-browser behavior.
export async function withDurableGenerationWriter<T>(scope: DurableGenerationScope, write: () => Promise<T>) {
  const release = await acquireDurableGenerationWriter(scope);
  try { return await write(); } finally { await release(); }
}

// Discard requires exclusive immediate custody; active capture/promotion or missing Web Locks retains data.
export async function withDurableGenerationDiscard(scope: DurableGenerationScope, discard: () => Promise<boolean>, locks = globalThis.navigator?.locks) {
  if (!locks) return false;
  return locks.request(generationLockName(scope), { mode: "exclusive", ifAvailable: true }, async (lock) => lock ? discard() : false);
}

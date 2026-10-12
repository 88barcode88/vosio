import { createClient } from "@/lib/supabase/browser";
import { createIndexedDbDurableAudioRepository, type DurableAudioRepository, type DurableSafetyManifest } from "@/lib/live-recording/durable-audio";
import { withDurableGenerationDiscard } from "@/lib/live-recording/generation-lock";

// Explicit local discard verifies the current personal owner and atomically removes only the reviewed browser snapshot.
export async function discardDurableSafetyGeneration(input: {
  manifest: DurableSafetyManifest;
  repository?: DurableAudioRepository;
  locks?: LockManager;
  canDiscard?: () => boolean;
}) {
  const manifest = { ...input.manifest, parts: input.manifest.parts.map((part) => ({ ...part })) };
  if (manifest.partCount !== manifest.parts.length || manifest.partCount === 0
    || manifest.totalBytes !== manifest.parts.reduce((total, part) => total + part.size, 0)
    || manifest.pendingPartCount !== manifest.parts.filter((part) => part.uploadedAt === null).length) return false;
  const client = createClient();
  let currentOwner: string | null = null;
  let changed = false;
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== manifest.ownerId) changed = true;
  });
  try {
    const auth = await client.auth.getUser();
    currentOwner = auth.error ? null : auth.data.user?.id ?? null;
    // Retain the exact owner fence inside the transaction, including a sign-out/re-sign-in during confirmation.
    const canDelete = () => !changed && currentOwner === manifest.ownerId && (input.canDiscard?.() ?? true);
    if (!canDelete()) return false;
    const repository = input.repository ?? createIndexedDbDurableAudioRepository();
    return await withDurableGenerationDiscard(manifest, async () => canDelete()
      ? repository.deleteExactGeneration?.(manifest.ownerId, manifest.recordingId, manifest.generationId, manifest.parts, canDelete) ?? false
      : false, input.locks);
  } finally { subscription.unsubscribe(); }
}

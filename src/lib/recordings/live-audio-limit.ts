const LIVE_AUDIO_POLICY_MAX_BYTES = 128 * 1024 * 1024;
const LIVE_AUDIO_DISCARD_RESERVE_RATIO = 0.05;
const LIVE_AUDIO_DISCARD_RESERVE_MAX_BYTES = 2 * 1024 * 1024;

// getLiveAudioMaxFileSizeBytes derives the encoded-audio limit for browser live recordings.
export function getLiveAudioMaxFileSizeBytes(bucketMaxFileSizeBytes: number | null) {
  if (bucketMaxFileSizeBytes === null) {
    return null;
  }

  return Math.min(bucketMaxFileSizeBytes, LIVE_AUDIO_POLICY_MAX_BYTES);
}

// getLiveAudioDiscardEstimateBytes leaves encoder headroom before the final Blob is assembled.
export function getLiveAudioDiscardEstimateBytes(maxFileSizeBytes: number | null) {
  if (maxFileSizeBytes === null) {
    return null;
  }

  const reserveBytes = Math.min(
    maxFileSizeBytes * LIVE_AUDIO_DISCARD_RESERVE_RATIO,
    LIVE_AUDIO_DISCARD_RESERVE_MAX_BYTES
  );

  return maxFileSizeBytes - reserveBytes;
}

// isLiveAudioBlobWithinLimit validates the actual finalized encoded Blob before it is uploaded.
export function isLiveAudioBlobWithinLimit(blob: Blob | null, maxFileSizeBytes: number | null) {
  return Boolean(
    blob &&
    maxFileSizeBytes !== null &&
    blob.size > 0 &&
    blob.size <= maxFileSizeBytes
  );
}

export type UploadProgressFile = {
  size: number;
};

export type AggregateUploadProgress = {
  bytesSent: number;
  bytesTotal: number;
  percentage: number;
};

// createUploadProgressTracker combines serial file progress using each file's byte weight.
export function createUploadProgressTracker(files: UploadProgressFile[]) {
  const totals = files.map((file) => Math.max(0, file.size));
  const sent = totals.map(() => 0);
  const bytesTotal = totals.reduce((total, size) => total + size, 0);
  let highWaterBytes = 0;

  // getSnapshot returns monotonic aggregate progress even if a transport emits stale counters.
  function getSnapshot(): AggregateUploadProgress {
    const currentBytes = sent.reduce((total, value) => total + value, 0);
    highWaterBytes = Math.min(bytesTotal, Math.max(highWaterBytes, currentBytes));
    const percentage = bytesTotal > 0 ? Math.round((highWaterBytes / bytesTotal) * 100) : 0;

    return { bytesSent: highWaterBytes, bytesTotal, percentage };
  }

  return {
    // updateFileProgress records a file's latest safe byte count.
    updateFileProgress(index: number, bytesSent: number) {
      if (index < 0 || index >= sent.length) {
        return getSnapshot();
      }

      sent[index] = Math.max(sent[index] ?? 0, Math.min(totals[index] ?? 0, Math.max(0, bytesSent)));

      return getSnapshot();
    },
    // completeFile records all bytes for a successfully transferred file.
    completeFile(index: number) {
      if (index >= 0 && index < sent.length) {
        sent[index] = totals[index] ?? 0;
      }

      return getSnapshot();
    },
    getSnapshot
  };
}

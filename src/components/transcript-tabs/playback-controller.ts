export type PlaybackAudioElement = {
  currentTime: number;
  duration: number;
  play: () => Promise<void>;
  readyState: number;
};

export type PlaybackController = {
  flushPendingSeek: () => Promise<void>;
  reset: () => void;
  seekToMs: (startMs: number, options?: { play?: boolean }) => Promise<void>;
};

type PendingSeek = {
  play: boolean;
  seconds: number;
};

// toAudioSeconds converts Soniox millisecond offsets into nonnegative media seconds.
export function toAudioSeconds(milliseconds: number) {
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) / 1000 : 0;
}

// clampSeekSeconds keeps a seek inside a finite media duration when metadata provides one.
export function clampSeekSeconds(seconds: number, duration: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  return Number.isFinite(duration) && duration >= 0
    ? Math.min(safeSeconds, duration)
    : safeSeconds;
}

// applySeek updates the media time and plays only when the caller explicitly requested it.
async function applySeek(audio: PlaybackAudioElement, pendingSeek: PendingSeek) {
  audio.currentTime = clampSeekSeconds(pendingSeek.seconds, audio.duration);

  if (pendingSeek.play) {
    await audio.play();
  }
}

// createPlaybackController coordinates metadata-delayed seeks while letting the newest request win.
export function createPlaybackController(
  getAudio: () => PlaybackAudioElement | null
): PlaybackController {
  let pendingSeek: PendingSeek | null = null;

  return {
    // flushPendingSeek applies the latest queued request after loadedmetadata.
    async flushPendingSeek() {
      const audio = getAudio();

      if (!audio || audio.readyState < 1 || !pendingSeek) {
        return;
      }

      const seek = pendingSeek;
      pendingSeek = null;
      await applySeek(audio, seek);
    },

    // reset discards navigation that belongs to an older recording or player source.
    reset() {
      pendingSeek = null;
    },

    // seekToMs seeks immediately with metadata or keeps only the latest pre-metadata request.
    async seekToMs(startMs, options = {}) {
      const seek = {
        play: options.play === true,
        seconds: toAudioSeconds(startMs)
      };
      const audio = getAudio();

      if (!audio || audio.readyState < 1) {
        pendingSeek = seek;
        return;
      }

      pendingSeek = null;
      await applySeek(audio, seek);
    }
  };
}

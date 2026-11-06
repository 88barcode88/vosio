// Offscreen document: mixes tab audio with the microphone, keeps the tab audible and records chunks into IndexedDB.

import { getStore } from "../db/store.ts";
import { isRecord } from "../shared/format.ts";
import type { OffscreenStartResult, OffscreenStatusResult } from "../shared/messages.ts";
import { SessionRecorder, type RecorderLike } from "./session-recorder.ts";

const HEARTBEAT_MS = 20_000;

interface RunningCapture {
  sessionId: string;
  recorder: SessionRecorder;
  context: AudioContext;
  streams: MediaStream[];
  heartbeat: ReturnType<typeof setInterval>;
}

let running: RunningCapture | null = null;

// Notifies the service worker (ignoring delivery errors) about capture events.
function notify(message: Record<string, unknown>): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

// Releases audio nodes and media tracks of a capture.
async function release(capture: RunningCapture): Promise<void> {
  clearInterval(capture.heartbeat);
  for (const stream of capture.streams) stream.getTracks().forEach((track) => track.stop());
  await capture.context.close().catch(() => undefined);
}

// Opens the microphone; null when permission was not granted (recording continues with tab audio only).
async function openMic(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch {
    return null;
  }
}

// Starts capturing: tab stream from the stream id, optional mic, AudioContext mix, MediaRecorder with chunks persisted at once.
async function startCapture(message: Record<string, unknown>): Promise<OffscreenStartResult> {
  if (running) return { ok: false, micAvailable: false, error: "Nahrávání už běží." };
  const sessionId = String(message.sessionId);
  let tabStream: MediaStream;
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: String(message.streamId) } },
      video: false
    });
  } catch {
    return { ok: false, micAvailable: false, error: "Zvuk karty se nepodařilo zachytit. Zkuste to znovu kliknutím na ikonu rozšíření na kartě se schůzkou." };
  }
  const micStream = await openMic();
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const tabSource = context.createMediaStreamSource(tabStream);
  tabSource.connect(destination);
  // Capturing a tab mutes it; routing it to the speakers keeps the meeting audible for the user.
  tabSource.connect(context.destination);
  // The microphone goes only to the recording, never to the speakers (no echo).
  if (micStream) context.createMediaStreamSource(micStream).connect(destination);
  await context.resume();

  const requested = String(message.recorderMimeType);
  const mimeType = MediaRecorder.isTypeSupported(requested) ? requested : "audio/webm";
  const recorder = new SessionRecorder(
    {
      // MediaRecorder structurally satisfies RecorderLike except for DOM event typings.
      createRecorder: () => new MediaRecorder(destination.stream, { mimeType, audioBitsPerSecond: Number(message.audioBitsPerSecond) }) as unknown as RecorderLike,
      saveChunk: (chunk) => getStore().addChunk(chunk),
      now: () => Date.now(),
      onError: () => notify({ type: "capture-ended", sessionId, reason: "write-error" })
    },
    { sessionId, maxPartBytes: Number(message.maxPartBytes) }
  );
  const streams = micStream ? [tabStream, micStream] : [tabStream];
  const heartbeat = setInterval(() => notify({ type: "capture-heartbeat", sessionId }), HEARTBEAT_MS);
  running = { sessionId, recorder, context, streams, heartbeat };
  tabStream.getAudioTracks()[0]?.addEventListener("ended", () => notify({ type: "capture-ended", sessionId, reason: "track-ended" }));
  recorder.start();
  return { ok: true, micAvailable: micStream !== null };
}

// Stops the running capture, flushes all chunks to IndexedDB and releases media resources.
async function stopCapture(): Promise<{ ok: boolean; parts: number }> {
  const capture = running;
  if (!capture) return { ok: true, parts: 0 };
  running = null;
  const parts = await capture.recorder.stop();
  await release(capture);
  return { ok: true, parts };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRecord(message) || message.target !== "offscreen") return undefined;
  let result: Promise<unknown>;
  if (message.type === "offscreen-start") result = startCapture(message);
  else if (message.type === "offscreen-stop") result = stopCapture();
  else if (message.type === "offscreen-status") result = Promise.resolve<OffscreenStatusResult>({ sessionId: running?.sessionId ?? null });
  else return undefined;
  result.then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, micAvailable: false, error: error instanceof Error ? error.message : "Chyba nahrávání." }));
  return true;
});

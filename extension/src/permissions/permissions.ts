// One-time microphone permission page: offscreen documents cannot prompt, so the grant happens on this visible extension page.

const result = document.getElementById("result") as HTMLElement;
const allow = document.getElementById("allow") as HTMLButtonElement;

// Shows a status message with a semantic color class.
function show(text: string, kind: "ok" | "error" | "muted"): void {
  result.textContent = text;
  result.className = kind;
}

// Reads the current microphone permission state, or "unknown" when the Permissions API does not report it.
async function currentState(): Promise<string> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

// Requests microphone access (prompting once) and immediately releases the stream.
async function requestMic(): Promise<void> {
  allow.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    show("Mikrofon je povolen. Tuto kartu můžete zavřít.", "ok");
  } catch {
    show("Mikrofon nebyl povolen. Povolení můžete změnit v nastavení webu rozšíření v prohlížeči; do té doby se bude nahrávat jen zvuk schůzky.", "error");
  } finally {
    allow.disabled = false;
  }
}

allow.addEventListener("click", () => void requestMic());
void currentState().then((state) => {
  if (state === "granted") show("Mikrofon už je povolen.", "ok");
});

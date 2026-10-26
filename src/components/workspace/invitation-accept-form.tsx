"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { verifyInvitationIdentityAction } from "@/lib/auth/actions";
import { invitationPreviewSchema, invitationTokenSchema, type InvitationPreview } from "@/lib/recording-sharing/invitation-contract";

// InvitationAcceptForm keeps the email link token in memory and requires an explicit acceptance click.
export function InvitationAcceptForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [type, setType] = useState<"invite" | "email">("email");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [message, setMessage] = useState("Načítám pozvánku…");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const pending = useRef(false);
  const loadedToken = useRef<{ token: string; type: "invite" | "email" } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const parsed = invitationTokenSchema.safeParse(params.get("token"));
    if (parsed.success && (params.get("type") === "invite" || params.get("type") === "email")) {
      loadedToken.current = { token: parsed.data, type: params.get("type") as "invite" | "email" };
    }
    window.history.replaceState(null, "", window.location.pathname);
    const invitation = loadedToken.current;
    if (!invitation) { setMessage("Otevřete úplný odkaz z pozvánkového e-mailu."); return; }
    setToken(invitation.token); setType(invitation.type);
    setMessage("Ověřte e-mail kódem z pozvánky. Samotné otevření odkazu přístup nepřidá.");
    const controller = new AbortController();
    // loadPreview is read-only and succeeds only for the intended verified account.
    async function loadPreview() {
      try {
        const result = await fetch("/api/recording-invitations", { headers: { "x-invitation-token": invitation!.token }, cache: "no-store", signal: controller.signal });
        if (result.ok && !controller.signal.aborted) {
          const safe = invitationPreviewSchema.parse(await result.json());
          if (!controller.signal.aborted) { setPreview(safe); setMessage("Pozvánka je připravena k přijetí."); }
        }
      } catch { /* Anonymous, unavailable and aborted previews reveal no scope metadata. */ }
    }
    void loadPreview();
    return () => controller.abort();
  }, []);

  // verifyIdentity exchanges an email OTP and optionally sets the invited account's initial password.
  async function verifyIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const password = form.get("password");
      const confirmation = form.get("confirmation");
      const result = await verifyInvitationIdentityAction({ token, type, email: form.get("email"), code: form.get("code"), ...(type === "invite" || password || confirmation ? { password, confirmation } : {}) });
      if (result.ok) { setPreview(result.preview); setMessage("E-mail je ověřený. Nyní můžete přijmout pozvánku."); }
      else setMessage(result.error);
    } catch { setMessage("Ověření se nepovedlo. Zkuste to znovu."); }
    finally { pending.current = false; setBusy(false); }
  }

  // accept explicitly redeems the token once; uncertain responses permit the same-user idempotent retry.
  async function accept() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const response = await fetch("/api/recording-invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      setAccepted(true); setToken(""); loadedToken.current = null; setMessage("Pozvánka byla přijata.");
      router.refresh();
    } catch { setMessage("Pozvánku nelze přijmout. Zkuste to znovu, případně požádejte o novou pozvánku."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <>
    <p role="status" aria-live="polite">{message}</p>
    {accepted ? <Link href="/recordings">Otevřít nahrávky</Link> : preview ? <>
      <p>Přístup: {preview.role === "editor" ? "Úpravy" : "Čtení"}. {preview.scope === "project" ? "Nahrávky sdílené v projektu včetně budoucích."
        : preview.scope === "client" || preview.scope === "folder" ? `Přístup k současným i budoucím nesoukromým nahrávkám ${preview.scope === "client" ? "klienta" : "složky"} v rozsahu pozvánky.`
        : `Vybrané nahrávky: ${preview.recordingCount}.`}</p>
      <p>{preview.scope === "project" ? "Soukromé nahrávky se touto projektovou pozvánkou nesdílejí."
        : preview.scope === "client" || preview.scope === "folder" ? "Soukromé nahrávky se touto pozvánkou nikdy nesdílejí."
        : "Přístup získáte pouze k nahrávkám v pozvánce. Ostatní soukromé nahrávky zůstanou soukromé."}</p>
      <button type="button" disabled={busy} onClick={accept}>{busy ? "Přijímám…" : "Přijmout pozvánku"}</button>
    </> : token ? <form className="auth-form" onSubmit={verifyIdentity}>
      <label>E-mail z pozvánky<input autoComplete="email" name="email" type="email" required disabled={busy} /></label>
      <label>Kód z e-mailu<input autoComplete="one-time-code" name="code" inputMode="numeric" pattern="[0-9]{6,10}" required disabled={busy} /></label>
      {type === "invite" ? <>
        <label>Nové heslo<input autoComplete="new-password" name="password" type="password" minLength={8} maxLength={128} required disabled={busy} /></label>
        <label>Heslo znovu<input autoComplete="new-password" name="confirmation" type="password" minLength={8} maxLength={128} required disabled={busy} /></label>
      </> : <details><summary>Nastavit nové heslo (volitelné)</summary>
        <label>Nové heslo<input autoComplete="new-password" name="password" type="password" minLength={8} maxLength={128} disabled={busy} /></label>
        <label>Heslo znovu<input autoComplete="new-password" name="confirmation" type="password" minLength={8} maxLength={128} disabled={busy} /></label>
      </details>}
      <button type="submit" disabled={busy}>{busy ? "Ověřuji…" : "Ověřit e-mail"}</button>
      <p>Po obnovení stránky otevřete znovu odkaz z e-mailu.</p>
    </form> : null}
  </>;
}

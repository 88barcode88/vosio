import type { Metadata } from "next";
import { InvitationAcceptForm } from "@/components/workspace/invitation-accept-form";

export const metadata: Metadata = { title: "Přijmout pozvánku | Vosio", referrer: "no-referrer", robots: { index: false, follow: false } };

// InvitationAcceptPage is a public shell; preview and redemption always require verified identity.
export default function InvitationAcceptPage() {
  return <main className="auth-page"><section className="auth-card"><h1>Pozvánka do Vosio</h1><InvitationAcceptForm /></section></main>;
}

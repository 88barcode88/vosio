import type { Metadata } from "next";
import { InvitationAcceptForm } from "@/components/workspace/invitation-accept-form";
import styles from "./invitation.module.css";

export const metadata: Metadata = { title: "Přijmout pozvánku | Vosio", referrer: "no-referrer", robots: { index: false, follow: false } };

// InvitationAcceptPage provides a mobile-safe public shell; preview and redemption require verified identity.
export default function InvitationAcceptPage() {
  return <main className={`auth-shell ${styles.shell}`}><section className={styles.content} aria-label="Přijetí pozvánky do Vosio"><h1>Pozvánka do Vosio</h1><InvitationAcceptForm /></section></main>;
}

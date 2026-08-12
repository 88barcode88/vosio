import type { Metadata } from "next";
import { getPublicEnvironmentIssues } from "@/lib/env";
import { getInstallationEnvironment, type InstallationEnvironment } from "@/lib/installation-status.server";
import styles from "./page.module.css";

const environmentLabels: Record<InstallationEnvironment, string> = {
  development: "Vývoj",
  preview: "Preview",
  production: "Produkce",
  unknown: "Neznámé"
};

export const metadata: Metadata = {
  title: "Konfigurace aplikace | Vosio"
};

// ConfigurationPage renders public-only setup diagnostics without loading a Supabase client.
export default function ConfigurationPage() {
  const missingNames = getPublicEnvironmentIssues();
  const environment = getInstallationEnvironment();
  const ready = missingNames.length === 0;

  return (
    <main className={styles.page}>
      <section aria-labelledby="configuration-title" className={styles.card}>
        <p className={styles.eyebrow}>Vosio · {environmentLabels[environment]}</p>
        <h1 id="configuration-title">Konfigurace aplikace</h1>

        {ready ? (
          <div className={styles.status} data-state="ready">
            <strong>Veřejná konfigurace je připravená.</strong>
            <p>Aplikace může pokračovat k přihlášení a práci s nahrávkami.</p>
          </div>
        ) : (
          <>
            <div className={styles.status} data-state="missing" role="status">
              <strong>Chybí veřejná konfigurace Supabase.</strong>
              <p>Vosio se nemůže bezpečně připojit, dokud nejsou doplněné tyto proměnné:</p>
            </div>
            <ul className={styles.variables} aria-label="Chybějící veřejné proměnné">
              {missingNames.map((name) => (
                <li key={name}><code>{name}</code></li>
              ))}
            </ul>
            <p className={styles.guidance}>
              Nastavte uvedené proměnné v hostovacím prostředí a potom aplikaci znovu nasaďte nebo
              restartujte. Hodnoty se na této stránce nikdy nezobrazují.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

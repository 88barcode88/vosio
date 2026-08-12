"use client";

import { useState } from "react";
import { CheckCircle2, Settings2, TriangleAlert } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Disclosure } from "@/components/ui/disclosure";
import { APP_VERSION } from "@/lib/app-version";
import type { InstallationEnvironment, InstallationStatus } from "@/lib/installation-status.server";
import { getRecordingStorageLimitSummary } from "@/lib/recordings/storage-copy";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import { supabaseStoragePlans, type UserSettings } from "@/lib/settings/types";
import {
  AI_MODEL_QUALITY_GUIDANCE,
  aiModelOptions,
  getAiModelDescription,
  sonioxRealtimeModelOptions
} from "@/lib/model-options";
import { sonioxRealtimeLanguageOptions } from "@/lib/soniox/languages";
import { sonioxRegionOptions, type SonioxRegion } from "@/lib/soniox/region";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";

type SettingsPanelProps = {
  disableSave?: boolean;
  installationStatus: InstallationStatus;
  recordingStorageConfig: RecordingStorageConfig;
  settings: UserSettings;
  status: "error" | "saved" | null;
  usageState: CurrentMonthUsageState;
};

const installationEnvironmentLabels: Record<InstallationEnvironment, string> = {
  development: "Vývoj",
  preview: "Preview",
  production: "Produkce",
  unknown: "Neznámé"
};

const supabaseStoragePlanLabels: Record<(typeof supabaseStoragePlans)[number], string> = {
  auto: "Auto",
  free: "Free",
  paid: "Paid"
};

// formatUsageInteger keeps count-like values compact and locale-aware.
function formatUsageInteger(value: number) {
  return new Intl.NumberFormat("cs-CZ").format(value);
}

// formatUsageCurrency labels local cost calculations as estimates rather than invoices.
function formatUsageCurrency(value: number) {
  if (value > 0 && value < 0.0001) return "<$0.0001";

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 4,
    minimumFractionDigits: value >= 1 ? 2 : 4,
    style: "currency"
  }).format(value);
}

// formatUsageDuration handles recording durations when a row has no stored duration.
function formatUsageDuration(seconds: number | null) {
  if (seconds === null) return "bez uložené délky";
  if (seconds < 60) return `${formatUsageInteger(seconds)} s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

// formatUsageFileSize keeps nullable byte totals explicit in the diagnostic summary.
function formatUsageFileSize(bytes: number | null) {
  if (bytes === null) return "bez uložené velikosti";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

// formatUsagePeriod displays the month-to-date window without exposing provider billing state.
function formatUsagePeriod(startIso: string) {
  return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date(startIso));
}

// UsageContent renders only the app's own month-to-date aggregate, error, or zero state.
function UsageContent({ state }: { state: CurrentMonthUsageState }) {
  if (state.summary === null) {
    return <p className="settings-usage-state" role="status">{state.error}</p>;
  }

  const { summary } = state;
  const isEmpty = summary.ai.jobCount === 0 && summary.recordings.count === 0 && summary.soniox.jobCount === 0;
  const hasIncompleteCoverage = summary.ai.jobsMissingTokenUsage > 0
    || summary.ai.unpricedModelIds.length > 0
    || summary.recordings.withDurationCount < summary.recordings.count
    || summary.recordings.withFileSizeCount < summary.recordings.count
    || summary.soniox.jobsMissingDurationCount > 0;

  if (isEmpty) {
    return (
      <article className="settings-usage-state settings-usage-empty">
        <strong>Zatím bez usage v tomto měsíci.</strong>
        <p>Po první nahrávce nebo AI výstupu se zde objeví orientační souhrn.</p>
      </article>
    );
  }

  return (
    <div className="settings-usage-summary">
      <p>Tento měsíc: {formatUsagePeriod(summary.period.startIso)}.</p>
      <dl>
        <div><dt>AI joby</dt><dd>{formatUsageInteger(summary.ai.jobCount)}</dd></div>
        <div><dt>AI odhad</dt><dd>{formatUsageCurrency(summary.ai.estimatedCostUsd)}</dd></div>
        <div><dt>Soniox odhad</dt><dd>{formatUsageCurrency(summary.soniox.estimatedCostUsd)}</dd></div>
        <div><dt>Nahrávky</dt><dd>{formatUsageInteger(summary.recordings.count)}</dd></div>
        <div><dt>Délka nahrávek</dt><dd>{formatUsageDuration(summary.recordings.totalDurationSeconds)}</dd></div>
        <div><dt>Velikost nahrávek</dt><dd>{formatUsageFileSize(summary.recordings.totalFileSizeBytes)}</dd></div>
      </dl>
      <p className="settings-estimate-note">
        Odhad vychází z uložených tokenů, délek a lokálního ceníku v aplikaci. Není to provider billing ani zdravotní stav služby.
      </p>
      {hasIncompleteCoverage ? (
        <div className="settings-coverage">
          <p className="settings-coverage-status" role="status">
            <strong>Neúplná data</strong>
            <span>Součty a odhady používají jen dostupná metadata.</span>
          </p>
          <Disclosure
            className="settings-disclosure settings-coverage-disclosure"
            keepMounted
            label="Pokrytí dat využití"
            triggerLabel="Více informací"
          >
            <ul className="settings-coverage-list">
              {summary.ai.jobsMissingTokenUsage > 0 ? (
                <li>AI joby bez uložených tokenů: {formatUsageInteger(summary.ai.jobsMissingTokenUsage)}. Tyto joby nejsou zahrnuté v AI odhadu.</li>
              ) : null}
              {summary.ai.unpricedModelIds.length > 0 ? (
                <li>Bez lokální ceny: {summary.ai.unpricedModelIds.join(", ")}. Tyto modely nejsou zahrnuté v AI odhadu.</li>
              ) : null}
              {summary.recordings.withDurationCount < summary.recordings.count ? (
                <li>{formatUsageInteger(summary.recordings.withDurationCount)} z {formatUsageInteger(summary.recordings.count)} nahrávek má uloženou délku.</li>
              ) : null}
              {summary.recordings.withFileSizeCount < summary.recordings.count ? (
                <li>{formatUsageInteger(summary.recordings.withFileSizeCount)} z {formatUsageInteger(summary.recordings.count)} nahrávek má uloženou velikost.</li>
              ) : null}
              {summary.soniox.jobsMissingDurationCount > 0 ? (
                <li>Soniox joby bez známé délky: {formatUsageInteger(summary.soniox.jobsMissingDurationCount)}. Tyto joby nejsou zahrnuté v odhadu.</li>
              ) : null}
            </ul>
          </Disclosure>
        </div>
      ) : null}
    </div>
  );
}

// InstallationStatusDetails renders only the public configuration-presence contract.
export function InstallationStatusDetails({ status }: { status: InstallationStatus }) {
  return (
    <>
      <div><dt>Prostředí</dt><dd>{installationEnvironmentLabels[status.environment]}</dd></div>
      <div><dt>Konfigurace instalace</dt><dd>{status.ready ? "Připraveno" : "Chybí konfigurace"}</dd></div>
      <div><dt>GEMINI_API_KEY (volitelné)</dt><dd>{status.geminiConfigured ? "Nastaveno" : "Nenastaveno"}</dd></div>
      <div className="settings-technical-wide">
        <dt>Chybějící proměnné</dt>
        <dd>
          {status.missingRequiredNames.length > 0 ? (
            <ul className="settings-missing-environment-list">
              {status.missingRequiredNames.map((name) => <li key={name}><code>{name}</code></li>)}
            </ul>
          ) : status.ready ? "Žádné" : "Stav nelze určit"}
        </dd>
      </div>
    </>
  );
}

// SettingsPanel presents only preferences that the current runtime can apply.
export function SettingsPanel({ disableSave = false, installationStatus, recordingStorageConfig, settings, status, usageState }: SettingsPanelProps) {
  const [sonioxRegion, setSonioxRegion] = useState<SonioxRegion>(settings.sonioxRegion);
  const storageLimitSummary = getRecordingStorageLimitSummary(recordingStorageConfig, settings.supabaseStoragePlan);
  const sonioxRealtimeModel = sonioxRealtimeModelOptions.find((option) => option.id === settings.sonioxRealtimeModel)
    ?? sonioxRealtimeModelOptions[0];

  return (
    <section className="utility-panel settings-panel" aria-label="Nastavení">
      <div className="utility-header settings-header">
        <Settings2 size={20} />
        <div>
          <h1>Nastavení</h1>
          <p>Výchozí chování pro nové nahrávky a přepisy. Tajné klíče zůstávají pouze na serveru.</p>
        </div>
      </div>

      {status ? (
        <div aria-live="polite" className={status === "saved" ? "settings-alert settings-alert-success" : "settings-alert settings-alert-error"} role={status === "saved" ? "status" : "alert"}>
          <CheckCircle2 size={17} />
          {status === "saved" ? "Nastavení je uložené." : "Nastavení se nepodařilo uložit."}
        </div>
      ) : null}

      <form action={disableSave ? undefined : updateUserSettingsAction} className="settings-form">
        <input name="aiTemperature" type="hidden" value={settings.aiTemperature} />
        <input name="audioRetentionPolicy" type="hidden" value={settings.audioRetentionPolicy} />
        <input name="autoProcessAfterTranscription" type="hidden" value={settings.autoProcessAfterTranscription ? "on" : "off"} />
        <input name="outputLanguage" type="hidden" value={settings.outputLanguage} />
        <input name="autoProcessingTypesPresent" type="hidden" value="1" />
        {settings.autoProcessingTypes.map((type) => <input key={type} name="autoProcessingTypes" type="hidden" value={type} />)}

        <section className="settings-section" aria-labelledby="settings-ai">
          <div className="settings-section-heading"><h2 id="settings-ai">AI a výstupy</h2><p>Model se předvyplní při ručním AI zpracování v detailu nahrávky.</p></div>
          <div className="settings-grid settings-grid-single">
            <label>
              <span>Výchozí AI model</span>
              <select name="defaultOpenaiModel" defaultValue={settings.defaultOpenaiModel}>
                {aiModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label} - {model.price}</option>)}
              </select>
              <small>{getAiModelDescription(settings.defaultOpenaiModel)}</small>
            </label>
          </div>
          <Disclosure label="Model a kvalita" triggerLabel="Model a kvalita" className="settings-disclosure">
            <p>{AI_MODEL_QUALITY_GUIDANCE}</p>
          </Disclosure>
        </section>

        <section className="settings-section" aria-labelledby="settings-transcription">
          <div className="settings-section-heading"><h2 id="settings-transcription">Jazyk a přepis</h2><p>Platí jako výchozí volba pro nový live záznam; před startem ji lze změnit.</p></div>
          <div className="settings-grid settings-grid-transcription">
            <label>
              <span>Region Soniox</span>
              <select
                name="sonioxRegion"
                onChange={(event) => setSonioxRegion(event.currentTarget.value as SonioxRegion)}
                value={sonioxRegion}
              >
                {sonioxRegionOptions.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}
              </select>
              <small>Region se použije pro live přepis i nové přepisy nahraných souborů.</small>
            </label>
            <label>
              <span>Výchozí jazyk live přepisu</span>
              <select name="sonioxRealtimeLanguage" defaultValue={settings.sonioxRealtimeLanguage}>
                {sonioxRealtimeLanguageOptions.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
              </select>
            </label>
            <label>
              <span>Soniox realtime model</span>
              <select name="sonioxRealtimeModel" defaultValue={settings.sonioxRealtimeModel}>
                {sonioxRealtimeModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
          </div>
          {sonioxRegion === "eu" ? (
            <aside aria-live="polite" className="settings-region-warning" role="note">
              <TriangleAlert aria-hidden="true" size={17} />
              <p>
                Region EU vyžaduje Soniox EU projekt a odpovídající regionální API klíč. Pokud se objeví chyba přístupu nebo autorizace, kontaktujte <a href="mailto:support@soniox.com">support@soniox.com</a>.
              </p>
            </aside>
          ) : null}
          <Disclosure label="Jak funguje live přepis" triggerLabel="Jak funguje live přepis" className="settings-disclosure">
            <p>{sonioxRealtimeModel.description} Pevná jazyková volba pomůže přepisu držet se jednoho jazyka; diarizace mluvčích zůstává zapnutá.</p>
          </Disclosure>
        </section>

        <section className="settings-section" aria-labelledby="settings-recording">
          <div className="settings-section-heading"><h2 id="settings-recording">Nahrávání</h2><p>Nastavení retence a automatických AI výstupů je připravené pro budoucí běh aplikace.</p></div>
          <p className="settings-stored-note">Některé dříve uložené preference zatím aplikace nepoužívá. Zachováváme je beze změny, ale nevydáváme je za aktivní ovládání.</p>
        </section>

        <section className="settings-section" aria-labelledby="settings-storage">
          <div className="settings-section-heading"><h2 id="settings-storage">Úložiště</h2><p>Volba pouze zpřísňuje lokální kontrolu velikosti uploadu pro tento účet.</p></div>
          <div className="settings-grid settings-grid-single">
            <label>
              <span>Supabase tarif pro limity</span>
              <select name="supabaseStoragePlan" defaultValue={settings.supabaseStoragePlan}>
                {supabaseStoragePlans.map((plan) => <option key={plan} value={plan}>{supabaseStoragePlanLabels[plan]}</option>)}
              </select>
              <small>Nemění Supabase projekt ani bucket.</small>
            </label>
          </div>
          <p className="settings-limit-callout">Efektivní limit manuálního uploadu: <strong>{storageLimitSummary.manualUploadLimit}</strong>.</p>
        </section>

        <section className="settings-section" aria-labelledby="settings-appearance">
          <div className="settings-section-heading"><h2 id="settings-appearance">Vzhled</h2><p>Motiv se uloží do cookie a localStorage, ne do Auth metadata.</p></div>
          <ThemeToggle />
        </section>

        <section className="settings-section settings-diagnostics" aria-labelledby="settings-diagnostics">
          <div className="settings-section-heading"><h2 id="settings-diagnostics">Diagnostika a využití</h2><p>Měsíční souhrn z řádků Vosio; ceny jsou orientační odhad.</p></div>
          <UsageContent state={usageState} />
          <Disclosure label="Technické informace" triggerLabel="Technické informace" className="settings-disclosure">
            <dl className="settings-technical-list">
              <div><dt>Verze aplikace</dt><dd>{APP_VERSION}</dd></div>
              <div><dt>Bucket recordings</dt><dd>{storageLimitSummary.bucketLimit}</dd></div>
              <div><dt>Manuální upload</dt><dd>{storageLimitSummary.manualUploadLimit}</dd></div>
              <div><dt>Live audio</dt><dd>{storageLimitSummary.liveAudioLimit}</dd></div>
              <InstallationStatusDetails status={installationStatus} />
              <div><dt>Serverové hranice</dt><dd>Dlouhodobé provider klíče zůstávají pouze na serveru. Klient pro live přepis získá krátkodobý Soniox api_key a konfiguraci regionu a WebSocketu.</dd></div>
            </dl>
            <p className="settings-limit-warning">{storageLimitSummary.warning}</p>
          </Disclosure>
        </section>

        <button className="settings-save-button" disabled={disableSave} type="submit">Uložit nastavení</button>
      </form>
    </section>
  );
}

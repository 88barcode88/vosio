import { CheckCircle2, LockKeyhole, Settings2 } from "lucide-react";
import { APP_VERSION } from "@/lib/app-version";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import {
  AI_MODEL_QUALITY_GUIDANCE,
  aiModelOptions,
  getAiModelDescription,
  sonioxRealtimeModelOptions
} from "@/lib/model-options";
import { sonioxRealtimeLanguageOptions } from "@/lib/soniox/languages";
import {
  audioRetentionPolicies,
  outputLanguages,
  settingsProcessingTypes,
  supabaseStoragePlans,
  type UserSettings
} from "@/lib/settings/types";
import { getRecordingStorageLimitSummary } from "@/lib/recordings/storage-copy";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import type { CurrentMonthUsageState, CurrentMonthUsageSummary } from "@/lib/usage/summary";

type SettingsPanelProps = {
  recordingStorageConfig: RecordingStorageConfig;
  settings: UserSettings;
  status: "error" | "saved" | null;
  usageState: CurrentMonthUsageState;
};

const outputLanguageLabels: Record<(typeof outputLanguages)[number], string> = {
  call_language: "Podle jazyka callu",
  cs: "Vždy česky",
  en: "Vždy anglicky"
};

const audioRetentionLabels: Record<(typeof audioRetentionPolicies)[number], string> = {
  delete_audio_after_transcription: "Smazat audio po přepisu",
  keep_audio: "Ponechat audio"
};

const supabaseStoragePlanLabels: Record<(typeof supabaseStoragePlans)[number], string> = {
  auto: "Auto",
  free: "Free",
  paid: "Paid"
};

const processingTypeLabels: Record<(typeof settingsProcessingTypes)[number], string> = {
  action_items: "Úkoly",
  crm_note: "CRM poznámka",
  follow_up_email: "E-mail po hovoru",
  meeting_minutes: "Zápis ze schůzky",
  summary: "Shrnutí"
};

// formatUsageInteger renders count-like usage values with Czech thousands separators.
function formatUsageInteger(value: number) {
  return new Intl.NumberFormat("cs-CZ").format(value);
}

// formatUsageCurrency renders small AI cost estimates without implying invoice precision.
function formatUsageCurrency(value: number) {
  if (value > 0 && value < 0.0001) {
    return "< $0.0001";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 4,
    minimumFractionDigits: value >= 1 ? 2 : 4,
    style: "currency"
  }).format(value);
}

// formatUsageDuration renders nullable recording duration totals for account usage.
function formatUsageDuration(seconds: number | null) {
  if (seconds === null) {
    return "bez uložené délky";
  }

  if (seconds < 60) {
    return `${formatUsageInteger(seconds)} s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

// formatUsageFileSize renders nullable byte totals while preserving explicit zero-byte rows.
function formatUsageFileSize(bytes: number | null) {
  if (bytes === null) {
    return "bez uložené velikosti";
  }

  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

// formatUsagePeriod renders the visible month label for the usage section.
function formatUsagePeriod(startIso: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    month: "long",
    year: "numeric"
  }).format(new Date(startIso));
}

// formatUsageCoverage explains how many rows had the metadata behind a displayed total.
function formatUsageCoverage(knownRows: number, totalRows: number) {
  if (totalRows === 0) {
    return "žádné řádky v měsíci";
  }

  return `${formatUsageInteger(knownRows)} z ${formatUsageInteger(totalRows)} řádků`;
}

// getUsageEstimateNote summarizes which parts of account usage are estimated or incomplete.
function getUsageEstimateNote(summary: CurrentMonthUsageSummary) {
  const notes = [
    "Cena je orientační výpočet z uložených tokenů a lokálního ceníku modelů v aplikaci."
  ];

  if (summary.ai.jobsMissingTokenUsage > 0) {
    notes.push(`${formatUsageInteger(summary.ai.jobsMissingTokenUsage)} AI jobů nemá uložené tokeny.`);
  }

  if (summary.ai.unpricedModelIds.length > 0) {
    notes.push(`Modely bez lokální ceny: ${summary.ai.unpricedModelIds.join(", ")}.`);
  }

  if (summary.recordings.deletedCount > 0) {
    notes.push(`Součet nahrávek zahrnuje i ${formatUsageInteger(summary.recordings.deletedCount)} položek v koši.`);
  }

  return notes.join(" ");
}

// formatUsageModelBreakdown renders the model-level cost basis used by the estimate.
function formatUsageModelBreakdown(summary: CurrentMonthUsageSummary) {
  if (summary.ai.modelBreakdown.length === 0) {
    return "Modely: žádné AI joby v měsíci.";
  }

  return `Modely: ${summary.ai.modelBreakdown
    .map((modelUsage) => {
      const cost = modelUsage.estimatedCostUsd === null
        ? "bez lokální ceny"
        : formatUsageCurrency(modelUsage.estimatedCostUsd);

      return `${modelUsage.model} · ${formatUsageInteger(modelUsage.jobCount)} jobů · ${cost}`;
    })
    .join("; ")}.`;
}

// getSonioxEstimateNote explains the STT estimate coverage and pricing basis.
function getSonioxEstimateNote(summary: CurrentMonthUsageSummary) {
  const { soniox } = summary;

  if (soniox.jobCount === 0) {
    return "Soniox: žádný přepisovací job v měsíci.";
  }

  return [
    `Soniox odhad: ${formatUsageDuration(soniox.billableDurationSeconds)} oceněno z ${formatUsageInteger(soniox.jobsWithDurationCount)} / ${formatUsageInteger(soniox.jobCount)} jobů.`,
    `Async ${formatUsageCurrency(soniox.asyncEstimatedCostUsd)} při $0.10/h, realtime ${formatUsageCurrency(soniox.realtimeEstimatedCostUsd)} při $0.12/h.`,
    soniox.jobsMissingDurationCount > 0
      ? `${formatUsageInteger(soniox.jobsMissingDurationCount)} jobů nemá známou délku, takže nejsou započítané.`
      : null
  ].filter(Boolean).join(" ");
}

// UsageSection renders read-only month-to-date account usage from existing Supabase rows.
function UsageSection({ state }: { state: CurrentMonthUsageState }) {
  if (state.summary === null) {
    return (
      <section className="settings-section settings-readonly settings-usage-section" aria-label="Vosio účet a usage">
        <div>
          <h2>Vosio účet / usage</h2>
        </div>
        <p>{state.error}</p>
      </section>
    );
  }

  const { summary } = state;

  return (
    <section className="settings-section settings-readonly settings-usage-section" aria-label="Vosio účet a usage">
      <div>
        <h2>Vosio účet / usage</h2>
      </div>
      <p>Tento měsíc: {formatUsagePeriod(summary.period.startIso)}.</p>
      <dl>
        <div>
          <dt>AI joby</dt>
          <dd>{formatUsageInteger(summary.ai.jobCount)}</dd>
        </div>
        <div>
          <dt>Tokeny input / output</dt>
          <dd>
            {formatUsageInteger(summary.ai.inputTokens)} / {formatUsageInteger(summary.ai.outputTokens)}
          </dd>
        </div>
        <div>
          <dt>AI cena</dt>
          <dd>{formatUsageCurrency(summary.ai.estimatedCostUsd)}</dd>
        </div>
        <div>
          <dt>Soniox odhad</dt>
          <dd>{formatUsageCurrency(summary.soniox.estimatedCostUsd)}</dd>
        </div>
        <div>
          <dt>Soniox délka</dt>
          <dd>{formatUsageDuration(summary.soniox.billableDurationSeconds)}</dd>
        </div>
        <div>
          <dt>Nahrávky</dt>
          <dd>{formatUsageInteger(summary.recordings.count)}</dd>
        </div>
        <div>
          <dt>Celková délka</dt>
          <dd>{formatUsageDuration(summary.recordings.totalDurationSeconds)}</dd>
        </div>
        <div>
          <dt>Celková velikost</dt>
          <dd>{formatUsageFileSize(summary.recordings.totalFileSizeBytes)}</dd>
        </div>
      </dl>
      <p>
        Metadata délky: {formatUsageCoverage(summary.recordings.withDurationCount, summary.recordings.count)}.
        {" "}Metadata velikosti: {formatUsageCoverage(summary.recordings.withFileSizeCount, summary.recordings.count)}.
      </p>
      <p>{formatUsageModelBreakdown(summary)}</p>
      <p>{getUsageEstimateNote(summary)}</p>
      <p>{getSonioxEstimateNote(summary)} Soniox dashboard zůstává zdroj pravdy pro fakturaci.</p>
    </section>
  );
}

// SettingsPanel renders safe user preferences, account usage, and read-only system boundaries.
export function SettingsPanel({ recordingStorageConfig, settings, status, usageState }: SettingsPanelProps) {
  const modelOptions = aiModelOptions;
  const storageLimitSummary = getRecordingStorageLimitSummary(
    recordingStorageConfig,
    settings.supabaseStoragePlan
  );
  const sonioxRealtimeModel =
    sonioxRealtimeModelOptions.find((option) => option.id === settings.sonioxRealtimeModel)
    ?? sonioxRealtimeModelOptions[0];

  return (
    <section className="utility-panel" aria-label="Nastavení">
      <div className="utility-header">
        <Settings2 size={24} />
        <div>
          <h1>Nastavení</h1>
          <p>Uživatelské preference pro AI zpracování a práci s nahrávkami. Tajné klíče a EU region zůstávají ve Vercelu.</p>
        </div>
      </div>

      {status ? (
        <div
          aria-live="polite"
          className={status === "saved" ? "settings-alert settings-alert-success" : "settings-alert settings-alert-error"}
          role={status === "saved" ? "status" : "alert"}
        >
          <CheckCircle2 size={17} />
          {status === "saved" ? "Nastavení je uložené." : "Nastavení se nepodařilo uložit."}
        </div>
      ) : null}

      <UsageSection state={usageState} />

      <form action={updateUserSettingsAction} className="settings-form">
        <section className="settings-section">
          <h2>AI výstupy</h2>
          <div className="settings-grid">
            <label>
              <span>Výchozí AI model</span>
              <select name="defaultOpenaiModel" defaultValue={settings.defaultOpenaiModel}>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} - {model.price}
                  </option>
                ))}
              </select>
              <small>{getAiModelDescription(settings.defaultOpenaiModel)}</small>
              <small>{AI_MODEL_QUALITY_GUIDANCE}</small>
            </label>
            <label>
              <span>Jazyk výstupu</span>
              <select name="outputLanguage" defaultValue={settings.outputLanguage}>
                {outputLanguages.map((language) => (
                  <option key={language} value={language}>
                    {outputLanguageLabels[language]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Soniox realtime model</span>
              <select name="sonioxRealtimeModel" defaultValue={settings.sonioxRealtimeModel}>
                {sonioxRealtimeModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <small>{sonioxRealtimeModel.description}</small>
            </label>
            <label>
              <span>Výchozí jazyk live přepisu</span>
              <select name="sonioxRealtimeLanguage" defaultValue={settings.sonioxRealtimeLanguage}>
                {sonioxRealtimeLanguageOptions.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label}
                  </option>
                ))}
              </select>
              <small>
                Automaticky rozpozná jazyk. Pevná volba pomůže Sonioxu držet se jednoho jazyka;
                rozpoznávání mluvčích zůstává zapnuté.
              </small>
            </label>
          </div>
          <label className="settings-check">
            <input
              defaultChecked={settings.autoProcessAfterTranscription}
              name="autoProcessAfterTranscription"
              type="checkbox"
            />
            <span>Automaticky spustit AI po dokončení přepisu</span>
          </label>
          <div className="settings-check-grid" aria-label="Automatické AI výstupy">
            {settingsProcessingTypes.map((processingType) => (
              <label className="settings-check" key={processingType}>
                <input
                  defaultChecked={settings.autoProcessingTypes.includes(processingType)}
                  name="autoProcessingTypes"
                  type="checkbox"
                  value={processingType}
                />
                <span>{processingTypeLabels[processingType]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h2>Data a nahrávky</h2>
          <div className="settings-grid">
            <label>
              <span>Retence audia</span>
              <select name="audioRetentionPolicy" defaultValue={settings.audioRetentionPolicy}>
                {audioRetentionPolicies.map((policy) => (
                  <option key={policy} value={policy}>
                    {audioRetentionLabels[policy]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Supabase tarif pro limity</span>
              <select name="supabaseStoragePlan" defaultValue={settings.supabaseStoragePlan}>
                {supabaseStoragePlans.map((plan) => (
                  <option key={plan} value={plan}>
                    {supabaseStoragePlanLabels[plan]}
                  </option>
                ))}
              </select>
              <small>Uživatelská preference pouze zpřísňuje upload v tomto účtu. Nemění Supabase projekt ani bucket.</small>
            </label>
          </div>
        </section>

        <section className="settings-section settings-readonly">
          <div>
            <LockKeyhole size={18} />
            <h2>Systémové hranice</h2>
          </div>
          <dl>
            <div>
              <dt>Verze aplikace</dt>
              <dd>{APP_VERSION}</dd>
            </div>
            <div>
              <dt>Soniox region</dt>
              <dd>Řízeno server env podle Soniox projektu</dd>
            </div>
            <div>
              <dt>API klíče</dt>
              <dd>Pouze server-side ve Vercelu</dd>
            </div>
            <div>
              <dt>Supabase preference</dt>
              <dd>{storageLimitSummary.planLabel}</dd>
            </div>
            <div>
              <dt>Globální limit projektu</dt>
              <dd>{storageLimitSummary.globalLimit}</dd>
            </div>
            <div>
              <dt>Bucket recordings</dt>
              <dd>{storageLimitSummary.bucketLimit}</dd>
            </div>
            <div>
              <dt>Efektivní limit manuálního uploadu</dt>
              <dd>{storageLimitSummary.manualUploadLimit}</dd>
            </div>
            <div>
              <dt>Efektivní limit live audia</dt>
              <dd>{storageLimitSummary.liveAudioLimit}</dd>
            </div>
          </dl>
          <p className="settings-limit-warning" role="status">{storageLimitSummary.warning}</p>
        </section>

        <button className="settings-save-button" type="submit">
          Uložit nastavení
        </button>
      </form>
    </section>
  );
}

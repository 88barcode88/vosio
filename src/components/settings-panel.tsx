"use client";

import { useActionState, useEffect, useRef, useState, type RefObject } from "react";
import { CheckCircle2, CircleDot, Save, Settings2, TriangleAlert } from "lucide-react";
import { ThemeChoice } from "@/components/theme-toggle";
import { AccountSecurityPanel } from "@/components/account-security-panel";
import { AiModelPicker, createAiModelSelection } from "@/components/ai-model-picker";
import { Disclosure } from "@/components/ui/disclosure";
import { APP_VERSION } from "@/lib/app-version";
import type { InstallationEnvironment, InstallationStatus } from "@/lib/installation-status.server";
import { getRecordingStorageLimitSummary } from "@/lib/recordings/storage-copy";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import { liveAudioQualityIds, liveAudioQualityOptions } from "@/lib/recordings/types";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import { createInitialSettingsActionState, type SettingsActionState } from "@/lib/settings/action-state";
import {
  supabaseStoragePlans,
  settingsProcessingTypes,
  trashRetentionHours,
  type TrashRetentionHours,
  type UserSettings
} from "@/lib/settings/types";
import {
  AI_MODEL_QUALITY_GUIDANCE,
  isApprovedSonioxAsyncModel,
  sonioxAsyncModelIds,
  sonioxAsyncModelLabels,
  sonioxRealtimeModelOptions
} from "@/lib/model-options";
import { sonioxRealtimeLanguageOptions } from "@/lib/soniox/languages";
import { sonioxRegionOptions, type SonioxRegion } from "@/lib/soniox/region";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";

type SettingsPanelProps = {
  accountEmail: string;
  disableAccountSecurity?: boolean;
  disableSave?: boolean;
  installationStatus: InstallationStatus;
  recordingStorageConfig: RecordingStorageConfig;
  settings: UserSettings;
  saveAction?: (state: SettingsActionState, formData: FormData) => Promise<SettingsActionState>;
  status: "error" | "saved" | null;
  usageState: CurrentMonthUsageState;
};

type VisibleSettingsDraft = Pick<
  UserSettings,
  | "autoTimelineAfterTranscription"
  | "automaticOutputTypes"
  | "defaultOpenaiModel"
  | "defaultReasoningEffort"
  | "liveAudioQuality"
  | "sonioxRealtimeLanguage"
  | "sonioxRealtimeModel"
  | "sonioxRegion"
  | "supabaseStoragePlan"
  | "trashRetentionHours"
>;

// createVisibleSettingsDraft copies only the settings represented by editable form controls.
function createVisibleSettingsDraft(settings: UserSettings): VisibleSettingsDraft {
  const selection = createAiModelSelection(settings.defaultOpenaiModel, settings.defaultReasoningEffort);
  return {
    autoTimelineAfterTranscription: settings.autoTimelineAfterTranscription,
    automaticOutputTypes: settings.automaticOutputTypes ?? [],
    defaultOpenaiModel: selection.model as UserSettings["defaultOpenaiModel"],
    defaultReasoningEffort: selection.reasoningEffort,
    liveAudioQuality: settings.liveAudioQuality,
    sonioxRealtimeLanguage: settings.sonioxRealtimeLanguage,
    sonioxRealtimeModel: settings.sonioxRealtimeModel,
    sonioxRegion: settings.sonioxRegion,
    supabaseStoragePlan: settings.supabaseStoragePlan,
    trashRetentionHours: settings.trashRetentionHours
  };
}

// getVisibleSettingsKey changes only when server-authoritative editable settings actually change.
function getVisibleSettingsKey(settings: UserSettings) {
  return JSON.stringify(createVisibleSettingsDraft(settings));
}

// SettingsSaveButton exposes the real pending state while a settings mutation is in flight.
function SettingsSaveButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button className="settings-save-button" disabled={disabled || pending} type="submit">
      <Save aria-hidden="true" size={15} />
      {pending ? "Ukládám nastavení…" : "Uložit nastavení"}
    </button>
  );
}

const settingsErrorMessages: Record<NonNullable<SettingsActionState["errorCode"]>, string> = {
  invalid_settings: "Nastavení se nepodařilo uložit: některá volba není platná. Zkontrolujte výběr a uložte znovu.",
  save_failed: "Nastavení se nepodařilo uložit. Změny zůstaly ve formuláři, zkuste to znovu za chvíli."
};

// SettingsSaveStatus tells whether the form holds unsaved edits, failed to save, or matches the saved state.
function SettingsSaveStatus({ actionState, dirty, errorRef }: {
  actionState: SettingsActionState;
  dirty: boolean;
  errorRef: RefObject<HTMLDivElement | null>;
}) {
  if (actionState.status === "error") {
    return (
      <div aria-live="assertive" className="settings-alert settings-alert-error" ref={errorRef} role="alert" tabIndex={-1}>
        <TriangleAlert aria-hidden="true" size={15} />
        <span>{settingsErrorMessages[actionState.errorCode ?? "save_failed"]}</span>
      </div>
    );
  }
  if (dirty) {
    return (
      <div aria-live="polite" className="settings-alert settings-alert-dirty" role="status">
        <CircleDot aria-hidden="true" size={15} />
        <span>Máte neuložené změny.</span>
      </div>
    );
  }
  if (actionState.status === "saved") {
    return (
      <div aria-live="polite" className="settings-alert settings-alert-success" role="status">
        <CheckCircle2 aria-hidden="true" size={15} />
        <span>Nastavení je uložené.</span>
      </div>
    );
  }
  return <p className="settings-savebar-hint">Heslo a motiv se ukládají samostatně hned po změně.</p>;
}

// FileTranscriptionModel shows which reviewed async model new uploads use and warns when the server value is unusable.
function FileTranscriptionModel({ model }: { model: string | undefined }) {
  if (!model) return <dd>Nezjištěno</dd>;
  if (!isApprovedSonioxAsyncModel(model)) {
    return (
      <dd className="settings-model-invalid" role="alert">
        <code>{model}</code> není schválený model. Nové přepisy souborů selžou, dokud proměnnou SONIOX_ASYNC_MODEL ve Vercelu nesmažete nebo nenastavíte na {sonioxAsyncModelIds.join(" nebo ")}.
      </dd>
    );
  }
  return (
    <dd>
      {sonioxAsyncModelLabels[model]}
      {model !== sonioxAsyncModelIds[0] ? (
        <small> Starší model, Soniox ho ukončí 15.12.2026. Smažte SONIOX_ASYNC_MODEL ve Vercelu, aby se použil {sonioxAsyncModelLabels[sonioxAsyncModelIds[0]]}.</small>
      ) : null}
    </dd>
  );
}

const settingsSections = [
  { id: "settings-account", label: "Účet" },
  { id: "settings-ai", label: "AI a výstupy" },
  { id: "settings-transcription", label: "Jazyk a přepis" },
  { id: "settings-recording", label: "Nahrávání" },
  { id: "settings-storage", label: "Úložiště" },
  { id: "settings-appearance", label: "Vzhled" },
  { id: "settings-diagnostics", label: "Využití" }
] as const;

const processingTypeLabels: Record<(typeof settingsProcessingTypes)[number], string> = {
  action_items: "Úkoly",
  crm_note: "CRM poznámka",
  follow_up_email: "Navazující e-mail",
  meeting_minutes: "Zápis ze schůzky",
  summary: "Shrnutí"
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

const trashRetentionLabels: Record<TrashRetentionHours, string> = {
  24: "24 hodin",
  168: "7 dní",
  720: "30 dní"
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
        <strong>Tento měsíc zatím bez využití.</strong>
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
      <div><dt>MISTRAL_API_KEY (volitelné)</dt><dd>{status.mistralConfigured ? "Nastaveno" : "Nenastaveno"}</dd></div>
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
export function SettingsPanel({ accountEmail, disableAccountSecurity = false, disableSave = false, installationStatus, recordingStorageConfig, saveAction = updateUserSettingsAction, settings, status, usageState }: SettingsPanelProps) {
  const [visibleDraft, setVisibleDraft] = useState(() => createVisibleSettingsDraft(settings));
  const [, setReconcileRevision] = useState(0);
  const visibleSettingsKey = getVisibleSettingsKey(settings);
  const previousVisibleSettingsKey = useRef(visibleSettingsKey);
  const errorAlertRef = useRef<HTMLDivElement>(null);
  const [actionState, formAction, pending] = useActionState(
    saveAction,
    createInitialSettingsActionState(status)
  );
  const storageLimitSummary = getRecordingStorageLimitSummary(recordingStorageConfig, visibleDraft.supabaseStoragePlan);
  const sonioxRealtimeModel = sonioxRealtimeModelOptions.find((option) => option.id === visibleDraft.sonioxRealtimeModel)
    ?? sonioxRealtimeModelOptions[0];
  const dirty = JSON.stringify(visibleDraft) !== visibleSettingsKey;

  useEffect(() => {
    if (actionState.status === "error") {
      setReconcileRevision((revision) => revision + 1);
      errorAlertRef.current?.focus();
    }
  }, [actionState]);

  useEffect(() => {
    if (previousVisibleSettingsKey.current === visibleSettingsKey) return;
    previousVisibleSettingsKey.current = visibleSettingsKey;
    setVisibleDraft(createVisibleSettingsDraft(settings));
  }, [settings, visibleSettingsKey]);

  return (
    <section className="utility-panel settings-panel" data-utility-surface="settings" aria-label="Nastavení">
      <div className="utility-header settings-header">
        <Settings2 size={20} />
        <div>
          <h1>Nastavení</h1>
          <p>Účet a výchozí chování pro nové nahrávky a přepisy. Tajné klíče zůstávají pouze na serveru.</p>
        </div>
      </div>

      <div className="settings-layout">
      <nav aria-label="Sekce nastavení" className="settings-nav">
        {settingsSections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.label}</a>)}
      </nav>
      <div className="settings-content">
      <AccountSecurityPanel disabled={disableAccountSecurity} email={accountEmail} />

      <form action={disableSave ? undefined : formAction} autoComplete="off" className="settings-form">
        <fieldset
          aria-busy={pending}
          className="settings-form-fields"
          data-settings-fields
          disabled={pending}
        >
        <input name="aiTemperature" type="hidden" value={settings.aiTemperature} />
        <input name="audioRetentionPolicy" type="hidden" value={settings.audioRetentionPolicy} />
        <input name="autoProcessAfterTranscription" type="hidden" value={settings.autoProcessAfterTranscription ? "on" : "off"} />
        <input name="outputLanguage" type="hidden" value={settings.outputLanguage} />
        <input name="autoProcessingTypesPresent" type="hidden" value="1" />
        {settings.autoProcessingTypes.map((type) => <input key={type} name="autoProcessingTypes" type="hidden" value={type} />)}

        <section className="settings-section" aria-labelledby="settings-ai">
          <div className="settings-section-heading"><h2 id="settings-ai">AI a výstupy</h2><p>Model se používá pro ruční AI zpracování i pro novou automatickou časovou osu.</p></div>
          <div className="settings-grid settings-model-row">
            <div className="settings-model-column">
              <AiModelPicker
                disabled={disableSave || pending}
                modelLabel="Výchozí AI model"
                modelName="defaultOpenaiModel"
                onChange={(selection) => setVisibleDraft((draft) => ({
                  ...draft,
                  defaultOpenaiModel: selection.model as UserSettings["defaultOpenaiModel"],
                  defaultReasoningEffort: selection.reasoningEffort
                }))}
                preserveReasoningPreference
                reasoningName="defaultReasoningEffort"
                scope="Výchozí volba pro nové AI požadavky."
                value={createAiModelSelection(visibleDraft.defaultOpenaiModel, visibleDraft.defaultReasoningEffort)}
              />
              <p className="settings-model-guidance"><strong>Model a kvalita: </strong>{AI_MODEL_QUALITY_GUIDANCE}</p>
            </div>
            <fieldset className="settings-automatic-group">
              <legend>Automaticky po dokončení přepisu</legend>
              <p className="settings-stored-note">Každý zapnutý výstup se zpracuje samostatně výchozím AI modelem. Vše vypnuto znamená žádné automatické AI zpracování.</p>
              <div className="settings-automatic-options">
                {settingsProcessingTypes.map((type) => (
                  <label className="settings-checkbox-row" key={type}>
                    <input checked={visibleDraft.automaticOutputTypes.includes(type)} disabled={disableSave}
                      name="automaticOutputTypes" type="checkbox" value={type}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setVisibleDraft((draft) => ({ ...draft, automaticOutputTypes: checked
                          ? [...draft.automaticOutputTypes, type] : draft.automaticOutputTypes.filter((item) => item !== type) }));
                      }} />
                    <span><strong>{processingTypeLabels[type]}</strong></span>
                  </label>
                ))}
              </div>
              <label className="settings-checkbox-row settings-timeline-option">
                <input
                  checked={visibleDraft.autoTimelineAfterTranscription}
                  disabled={disableSave}
                  name="autoTimelineAfterTranscription"
                  onChange={(event) => {
                    const value = event.currentTarget.checked;
                    setVisibleDraft((draft) => ({ ...draft, autoTimelineAfterTranscription: value }));
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>Automaticky vytvořit časovou osu po přepisu</strong>
                  <small>Časová osa se vytvoří i bez zapnutých výstupů.</small>
                </span>
              </label>
            </fieldset>
          </div>
        </section>

        <section className="settings-section settings-section-transcription" aria-labelledby="settings-transcription">
          <div className="settings-section-heading"><h2 id="settings-transcription">Jazyk a přepis</h2><p>Platí jako výchozí volba pro nový live záznam; před startem ji lze změnit.</p></div>
          <div className="settings-grid settings-grid-transcription">
            <label>
              <span>Region Soniox</span>
              <select
                disabled={disableSave}
                name="sonioxRegion"
                onChange={(event) => {
                  const value = event.currentTarget.value as SonioxRegion;
                  setVisibleDraft((draft) => ({ ...draft, sonioxRegion: value }));
                }}
                value={visibleDraft.sonioxRegion}
              >
                {sonioxRegionOptions.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}
              </select>
              <small>Region se použije pro live přepis i nové přepisy nahraných souborů.</small>
            </label>
            <label>
              <span>Výchozí jazyk live přepisu</span>
              <select
                disabled={disableSave}
                name="sonioxRealtimeLanguage"
                onChange={(event) => {
                  const value = event.currentTarget.value as UserSettings["sonioxRealtimeLanguage"];
                  setVisibleDraft((draft) => ({ ...draft, sonioxRealtimeLanguage: value }));
                }}
                value={visibleDraft.sonioxRealtimeLanguage}
              >
                {sonioxRealtimeLanguageOptions.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
              </select>
            </label>
            {sonioxRealtimeModelOptions.length > 1 ? (
              <label>
                <span>Soniox realtime model</span>
                <select
                  disabled={disableSave}
                  name="sonioxRealtimeModel"
                  onChange={(event) => {
                    const value = event.currentTarget.value as UserSettings["sonioxRealtimeModel"];
                    setVisibleDraft((draft) => ({ ...draft, sonioxRealtimeModel: value }));
                  }}
                  value={visibleDraft.sonioxRealtimeModel}
                >
                  {sonioxRealtimeModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
            ) : <input name="sonioxRealtimeModel" type="hidden" value={visibleDraft.sonioxRealtimeModel} />}
          </div>
          <dl aria-label="Modely přepisu" className="settings-model-list">
            <div><dt>Živý přepis</dt><dd>{sonioxRealtimeModel.label}</dd></div>
            <div><dt>Nahrané soubory</dt><FileTranscriptionModel model={installationStatus.fileTranscriptionModel} /></div>
          </dl>
          <aside aria-live="polite" className="settings-region-warning" role="note">
            <TriangleAlert aria-hidden="true" size={15} />
            <p>
              Region EU vyžaduje Soniox EU projekt a odpovídající regionální API klíč. Pokud se objeví chyba přístupu nebo autorizace, kontaktujte <a href="mailto:support@soniox.com">support@soniox.com</a>.
            </p>
          </aside>
          <div className="settings-live-explanation">
            <strong>Jak funguje live přepis</strong>
            <p>{sonioxRealtimeModel.description} Pevná jazyková volba pomůže přepisu držet se jednoho jazyka; diarizace mluvčích zůstává zapnutá.</p>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-recording">
          <div className="settings-section-heading"><h2 id="settings-recording">Nahrávání</h2><p>Retence se uloží jako neměnný termín až při budoucím přesunutí nahrávky do Koše.</p></div>
          <div className="settings-grid settings-grid-recording">
            <div className="settings-audio-quality-field">
            <span>Kvalita live audia</span>
            <div aria-label="Kvalita live audia" className="settings-audio-quality-options" role="radiogroup">
              {liveAudioQualityIds.map((quality) => {
                const option = liveAudioQualityOptions[quality];

                return (
                  <label className="settings-audio-quality-option" key={quality}>
                    <input
                      checked={visibleDraft.liveAudioQuality === quality}
                      disabled={disableSave}
                      name="liveAudioQuality"
                      onChange={() => setVisibleDraft((draft) => ({ ...draft, liveAudioQuality: quality }))}
                      type="radio"
                      value={quality}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.audioBitsPerSecond / 1_000} kbit/s · {option.estimatedMegabytesPerHour.toFixed(1)} MB/h</small>
                    </span>
                  </label>
                );
              })}
            </div>
            </div>
            <label>
              <span>Budoucí položky v Koši</span>
              <select
                disabled={disableSave}
                name="trashRetentionHours"
                onChange={(event) => {
                  const value = Number(event.currentTarget.value) as TrashRetentionHours;
                  setVisibleDraft((draft) => ({ ...draft, trashRetentionHours: value }));
                }}
                value={visibleDraft.trashRetentionHours}
              >
                {trashRetentionHours.map((hours) => (
                  <option key={hours} value={hours}>{trashRetentionLabels[hours]}</option>
                ))}
              </select>
              <small>Změna platí jen pro nahrávky přesunuté do Koše po uložení.</small>
            </label>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-storage">
          <div className="settings-section-heading"><h2 id="settings-storage">Úložiště</h2><p>Volba pouze zpřísňuje lokální kontrolu velikosti uploadu pro tento účet.</p></div>
          <div className="settings-grid settings-grid-single">
            <label>
              <span>Supabase tarif pro limity</span>
              <select
                disabled={disableSave}
                name="supabaseStoragePlan"
                onChange={(event) => {
                  const value = event.currentTarget.value as UserSettings["supabaseStoragePlan"];
                  setVisibleDraft((draft) => ({ ...draft, supabaseStoragePlan: value }));
                }}
                value={visibleDraft.supabaseStoragePlan}
              >
                {supabaseStoragePlans.map((plan) => <option key={plan} value={plan}>{supabaseStoragePlanLabels[plan]}</option>)}
              </select>
              <small>Nemění Supabase projekt ani bucket.</small>
            </label>
          </div>
          <p className="settings-limit-callout">Efektivní limit manuálního uploadu: <strong>{storageLimitSummary.manualUploadLimit}</strong>.</p>
        </section>

        <section className="settings-section" aria-labelledby="settings-appearance">
          <div className="settings-section-heading"><h2 id="settings-appearance">Vzhled</h2><p>Motiv se přepne a uloží v tomto prohlížeči hned, bez tlačítka Uložit.</p></div>
          <ThemeChoice />
        </section>

        <section className="settings-section settings-diagnostics" aria-labelledby="settings-diagnostics">
          <div className="settings-section-heading"><h2 id="settings-diagnostics">Diagnostika a využití</h2><p>Měsíční souhrn z řádků Vosio; ceny jsou orientační odhad.</p></div>
          <UsageContent state={usageState} />
        </section>
        <section className="settings-section settings-technical-section">
          <Disclosure label="Technické informace" triggerLabel="Technické informace" className="settings-disclosure">
            <dl className="settings-technical-list">
              <div><dt>Verze aplikace</dt><dd>{APP_VERSION}</dd></div>
              <div><dt>Bucket recordings</dt><dd>{storageLimitSummary.bucketLimit}</dd></div>
              <div><dt>Manuální upload</dt><dd>{storageLimitSummary.manualUploadLimit}</dd></div>
              <div><dt>Live audio</dt><dd>{storageLimitSummary.liveAudioLimit}</dd></div>
              <InstallationStatusDetails status={installationStatus} />
              <div className="settings-technical-wide"><dt>Skryté preference</dt><dd>Některé dříve uložené preference zatím aplikace nepoužívá. Zachováváme je beze změny, ale nevydáváme je za aktivní ovládání.</dd></div>
              <div><dt>Serverové hranice</dt><dd>Dlouhodobé provider klíče zůstávají pouze na serveru. Klient pro live přepis získá krátkodobý Soniox api_key a konfiguraci regionu a WebSocketu.</dd></div>
            </dl>
            <p className="settings-limit-warning">{storageLimitSummary.warning}</p>
          </Disclosure>
        </section>

        <div className="settings-savebar">
          <SettingsSaveStatus actionState={actionState} dirty={dirty} errorRef={errorAlertRef} />
          <div className="settings-savebar-actions">
            {dirty ? (
              <button className="ghost-action" onClick={() => setVisibleDraft(createVisibleSettingsDraft(settings))} type="button">
                Zrušit změny
              </button>
            ) : null}
            <SettingsSaveButton disabled={disableSave} pending={pending} />
          </div>
        </div>
        </fieldset>
      </form>
      </div>
      </div>
    </section>
  );
}

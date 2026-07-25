import {
  getTranscriptSpeakerRoleLabel,
  type TranscriptSpeakerRole
} from "@/lib/transcripts/speakers";
import type { TranscriptTab } from "@/components/transcript-tabs/types";

export const knownMarkdownHeadings = [
  "Stručné shrnutí",
  "Hlavní body",
  "Důležité informace",
  "Důležité fakty",
  "CRM poznámka",
  "Potřeby",
  "Pain points",
  "Timing/rozpočet",
  "Sentiment",
  "Rizika/námitky",
  "Další obchodní krok",
  "Přehled",
  "Agenda",
  "Probraná témata",
  "Blokery",
  "Otevřené body",
  "Termíny",
  "Moje práce",
  "Klient",
  "Nejasné",
  "Nejasné / k přiřazení",
  "Rozhodnutí k potvrzení",
  "Rizika / blokery",
  "Časová osa",
  "Důležité signály / citace",
  "Otevřené otázky",
  "Výsledek",
  "Úkoly",
  "Rozhodnutí",
  "Rizika",
  "Další kroky",
  "Short summary",
  "Main points",
  "Important facts",
  "Open questions",
  "Outcome",
  "Action items",
  "Decisions",
  "Risks",
  "Next steps"
];

export const transcriptTabs: Array<{ id: TranscriptTab; label: string }> = [
  { id: "transcript", label: "Přepis" },
  { id: "ai", label: "AI zpracování" },
  { id: "timeline", label: "Časová osa" },
  { id: "files", label: "Soubory" }
];

export const speakerClassNames = [
  "speaker-teal",
  "speaker-violet",
  "speaker-orange",
  "speaker-blue",
  "speaker-green",
  "speaker-red",
  "speaker-cyan",
  "speaker-pink",
  "speaker-amber",
  "speaker-slate"
];

export const transcriptTabIds = transcriptTabs.map((tab) => tab.id);

export const speakerRoleOptions: Array<{ label: string; value: TranscriptSpeakerRole }> = [
  { label: getTranscriptSpeakerRoleLabel("unknown"), value: "unknown" },
  { label: getTranscriptSpeakerRoleLabel("client_customer"), value: "client_customer" },
  { label: getTranscriptSpeakerRoleLabel("delivery_team"), value: "delivery_team" }
];

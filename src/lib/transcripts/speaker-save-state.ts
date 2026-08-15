import type {
  TranscriptSpeakerRole,
  TranscriptSpeakerSummary
} from "@/lib/transcripts/speakers";

export type TranscriptSpeakerSaveInput = {
  name: string | null;
  revision: number;
  role: TranscriptSpeakerRole;
  speakerId: string;
  transcriptId: string;
};

export type TranscriptSpeakerSaveResult =
  | {
      revision: number;
      savedSpeaker: TranscriptSpeakerSummary;
      searchWarning: string | null;
      status: "success";
    }
  | {
      message: string;
      revision: number;
      status: "error";
    };

export const SPEAKER_SAVE_ERROR = "Mluvčího se nepodařilo uložit. Zkuste to znovu.";
export const SPEAKER_SEARCH_WARNING = "Mluvčí je uložený, ale vyhledávací index se nepodařilo obnovit.";

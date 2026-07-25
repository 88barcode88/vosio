import {
  AudioLines,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck,
  FileAudio,
  FileText,
  ListChecks,
  Mail,
  Settings2,
  Trash2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkspaceView = "recordings" | "ai" | "templates" | "documentation" | "trash" | "settings";

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  view: WorkspaceView;
};

export const navigationItems: NavigationItem[] = [
  { href: "/recordings", label: "Nahrávky", icon: FileAudio, view: "recordings" },
  { href: "/templates", label: "Prompty", icon: FileText, view: "templates" },
  { href: "/trash", label: "Koš", icon: Trash2, view: "trash" },
  { href: "/settings", label: "Nastavení", icon: Settings2, view: "settings" }
];

export const documentationNavigationItem: NavigationItem = {
  href: "/documentation",
  icon: BookOpen,
  label: "Dokumentace",
  view: "documentation"
};

export const quickActions = [
  { label: "Shrnutí", icon: FileText, processingType: "summary" },
  { label: "Úkoly", icon: ListChecks, processingType: "action_items" },
  { label: "Časová osa", icon: AudioLines, processingType: "timeline_chapters" },
  { label: "Zápis ze schůzky", icon: CalendarCheck, processingType: "meeting_minutes" },
  { label: "CRM poznámka", icon: BriefcaseBusiness, processingType: "crm_note" },
  { label: "E-mail po hovoru", icon: Mail, processingType: "follow_up_email" }
];

// Czech labels of the two sharing roles; the single source for every role picker and summary in the UI.
export const SHARING_ROLE_LABELS = { reader: "Čtení", editor: "Úpravy" } as const;

export type SharingRoleKey = keyof typeof SHARING_ROLE_LABELS;

// sharingRoleLabel returns the user-facing Czech name of a sharing role.
export function sharingRoleLabel(role: SharingRoleKey): string {
  return SHARING_ROLE_LABELS[role];
}

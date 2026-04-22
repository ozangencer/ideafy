export interface Project {
  id: string;
  name: string;
  idPrefix: string;
  color: string;
  folderPath: string;
  teamId?: string | null;
}

export interface TeamMemberInfo {
  userId: string;
  displayName: string;
}

export type AutocompleteType = "project" | "status" | "platform" | "complexity" | null;
export type AutocompleteKind = Exclude<AutocompleteType, null>;
export type FocusedField = "title" | "description";

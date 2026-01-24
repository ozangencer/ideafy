import { DocumentFile } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createDocumentsSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "documents"
    | "selectedDocument"
    | "documentContent"
    | "isDocumentEditorOpen"
    | "expandedDocFolders"
    | "fetchDocuments"
    | "openDocument"
    | "saveDocument"
    | "closeDocumentEditor"
    | "setDocumentContent"
    | "toggleDocFolder"
  >
> = (set, get) => ({
  documents: [],
  selectedDocument: null,
  documentContent: "",
  isDocumentEditorOpen: false,
  expandedDocFolders: ["docs/", "notes/"],

  fetchDocuments: async (projectId) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/documents`);
      const documents = await parseJson<DocumentFile[]>(response);
      set({ documents: Array.isArray(documents) ? documents : [] });
    } catch (error) {
      console.error("Failed to fetch documents:", error);
      set({ documents: [] });
    }
  },

  openDocument: async (doc) => {
    try {
      const response = await fetch(
        `/api/documents?path=${encodeURIComponent(doc.path)}`
      );
      const data = await parseJson<{ content?: string }>(response);
      set({
        selectedDocument: doc,
        documentContent: data.content || "",
        isDocumentEditorOpen: true,
      });
    } catch (error) {
      console.error("Failed to open document:", error);
    }
  },

  saveDocument: async () => {
    const { selectedDocument, documentContent } = get();
    if (!selectedDocument) return;

    try {
      await fetch(
        `/api/documents?path=${encodeURIComponent(selectedDocument.path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: documentContent }),
        }
      );
    } catch (error) {
      console.error("Failed to save document:", error);
    }
  },

  closeDocumentEditor: () => {
    set({
      selectedDocument: null,
      documentContent: "",
      isDocumentEditorOpen: false,
    });
  },

  setDocumentContent: (content) => set({ documentContent: content }),

  toggleDocFolder: (path) => {
    const { expandedDocFolders } = get();
    const isExpanded = expandedDocFolders.includes(path);
    set({
      expandedDocFolders: isExpanded
        ? expandedDocFolders.filter((p) => p !== path)
        : [...expandedDocFolders, path],
    });
  },
});

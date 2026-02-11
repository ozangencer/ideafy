"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";

export interface QuickEntryEditorRef {
  focus: () => void;
  getPlainText: () => string;
  getHTML: () => string;
  clear: () => void;
  isEmpty: () => boolean;
  deleteBackwards: (chars: number) => void;
}

interface QuickEntryEditorProps {
  placeholder?: string;
  onTextChange?: (plainText: string) => void;
  onKeyDown?: (event: KeyboardEvent) => boolean;
}

export const QuickEntryEditor = forwardRef<
  QuickEntryEditorRef,
  QuickEntryEditorProps
>(function QuickEntryEditor({ placeholder = "Notes", onTextChange, onKeyDown }, ref) {
  // Use refs to avoid stale closures in editorProps callbacks
  const onTextChangeRef = useRef(onTextChange);
  const onKeyDownRef = useRef(onKeyDown);

  useLayoutEffect(() => {
    onTextChangeRef.current = onTextChange;
    onKeyDownRef.current = onKeyDown;
  }, [onTextChange, onKeyDown]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    [placeholder]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: {
      attributes: {
        class: "prose-kanban quick-entry-editor",
      },
      handleKeyDown: (_view, event) => {
        if (onKeyDownRef.current) {
          return onKeyDownRef.current(event);
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onTextChangeRef.current?.(ed.getText());
    },
  });

  const focus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);

  const getPlainText = useCallback(() => {
    return editor?.getText() ?? "";
  }, [editor]);

  const getHTML = useCallback(() => {
    return editor?.getHTML() ?? "";
  }, [editor]);

  const clear = useCallback(() => {
    editor?.commands.clearContent();
  }, [editor]);

  const isEmpty = useCallback(() => {
    return !editor?.getText().trim();
  }, [editor]);

  const deleteBackwards = useCallback(
    (chars: number) => {
      if (!editor) return;
      const from = editor.state.selection.from;
      if (from < chars) return;
      // Replace trigger text with a non-breaking space
      editor
        .chain()
        .focus()
        .insertContentAt({ from: from - chars, to: from }, "\u00A0")
        .run();
    },
    [editor]
  );

  useImperativeHandle(
    ref,
    () => ({ focus, getPlainText, getHTML, clear, isEmpty, deleteBackwards }),
    [focus, getPlainText, getHTML, clear, isEmpty, deleteBackwards]
  );

  return <EditorContent editor={editor} />;
});

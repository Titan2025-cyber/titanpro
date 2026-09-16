import { useEffect, useRef } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, Undo2, Redo2, Type } from "lucide-react";

// Lightweight contenteditable rich-text editor. We keep it small on purpose
// so it doesn't drag in a giant editor library (Slate/Tiptap). document.execCommand
// is legacy but every browser we support still handles it and it's the same
// approach the Gmail web app uses under the hood.
//
// Props:
//   html:      the full HTML currently in the editor. When it changes from
//              outside (Reply/Forward/signature autofill), we sync it back
//              into the DOM only if the user hasn't been typing in the
//              editor since the last external change — otherwise the caret
//              jumps around while they're editing.
//   onChange:  called with the current HTML every input event.
//   minHeight: CSS px for the editor viewport.
export function RichTextEditor({
  html,
  onChange,
  minHeight = 220,
  placeholder = "Type your message…",
}: {
  html: string;
  onChange: (html: string) => void;
  minHeight?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastExternalHtml = useRef<string>(html);

  // Sync external html changes into the DOM without clobbering the caret.
  useEffect(() => {
    if (ref.current && html !== lastExternalHtml.current && html !== ref.current.innerHTML) {
      ref.current.innerHTML = html;
      lastExternalHtml.current = html;
    }
  }, [html]);

  // Toolbar action helper — execCommand runs against the current selection.
  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const promptLink = () => {
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    cmd("createLink", url);
  };

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b bg-muted/40 text-neutral-700 dark:text-neutral-300">
        <ToolbarBtn onClick={() => cmd("bold")} title="Bold (Ctrl+B)"><Bold className="w-3.5 h-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => cmd("italic")} title="Italic (Ctrl+I)"><Italic className="w-3.5 h-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => cmd("underline")} title="Underline (Ctrl+U)"><Underline className="w-3.5 h-3.5" /></ToolbarBtn>
        <span className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1" />
        <ToolbarBtn onClick={() => cmd("insertUnorderedList")} title="Bulleted list"><List className="w-3.5 h-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => cmd("insertOrderedList")} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={promptLink} title="Insert link"><Link2 className="w-3.5 h-3.5" /></ToolbarBtn>
        <span className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1" />
        <ToolbarBtn onClick={() => cmd("removeFormat")} title="Clear formatting"><Type className="w-3.5 h-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => cmd("undo")} title="Undo"><Undo2 className="w-3.5 h-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => cmd("redo")} title="Redo"><Redo2 className="w-3.5 h-3.5" /></ToolbarBtn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-testid="rich-text-editor"
        className="prose prose-sm dark:prose-invert max-w-none p-3 text-sm focus:outline-none [&_a]:text-[#1a73e8] [&_a]:underline"
        style={{ minHeight }}
        // Placeholder via CSS pseudo. We use data-placeholder + a small style below.
        data-placeholder={placeholder}
        onInput={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          lastExternalHtml.current = el.innerHTML;
          onChange(el.innerHTML);
        }}
      />
      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: rgb(163 163 163);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function ToolbarBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
    >
      {children}
    </button>
  );
}

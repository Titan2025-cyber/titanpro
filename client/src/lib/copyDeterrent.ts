// ── Anti-copy deterrent (honest speed-bump, NOT copy protection) ──────────────
//
// IMPORTANT: Anything a browser downloads can be inspected. This module cannot
// make the app copy-proof — the compiled JS/CSS is always retrievable. What it
// does is raise the effort for casual copying and signal that the app is
// proprietary. It is deliberately lightweight so it never interferes with
// legitimate use or accessibility.
//
// Enabled only in production builds. In development it is a no-op so we keep
// full devtools access while working.

const PROPRIETARY_NOTICE =
  "%c⚠ Titan Pro — Proprietary Software\n" +
  "%c© 2026 Titan Restoration LLC. All rights reserved.\n" +
  "This application and its source code are confidential and proprietary. " +
  "Unauthorized copying, reverse-engineering, or redistribution is prohibited " +
  "and may violate copyright and other laws. Questions: 706-922-0154.";

// Returns true if the element (or an ancestor) is a text-entry field where the
// native context menu (Copy/Paste/Cut) must stay available.
function isEditable(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (node.isContentEditable) return true;
    node = node.parentElement;
  }
  return false;
}

export function installCopyDeterrent() {
  // Only run in the production bundle. import.meta.env.PROD is inlined by Vite.
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined") return;

  // 1) Legal/ownership banner in the console so anyone who opens devtools sees
  //    the app is proprietary and confidential.
  try {
    // eslint-disable-next-line no-console
    console.log(
      PROPRIETARY_NOTICE,
      "font-size:14px;font-weight:bold;color:#c8102e;",
      "font-size:11px;color:#333;",
    );
  } catch {
    /* ignore */
  }

  // 2) Suppress the context (right-click) menu. Casual "Save As" / "View Source"
  //    speed-bump only. IMPORTANT: never block it inside editable fields, or
  //    users lose right-click Copy/Paste/Cut when entering data.
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && isEditable(t)) return; // allow native copy/paste menu in fields
    e.preventDefault();
  });

  // 3) Block the most common view-source / devtools keyboard shortcuts. This is
  //    a deterrent, not a lock — power users can still open devtools via menus.
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    // Ctrl/Cmd+U (view source), Ctrl/Cmd+S (save page), F12 (devtools),
    // Ctrl/Cmd+Shift+I/J/C (devtools/console/inspect).
    if (
      k === "f12" ||
      ((e.ctrlKey || e.metaKey) && (k === "u" || k === "s")) ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c"))
    ) {
      e.preventDefault();
    }
  });

  // 4) Discourage drag-copying of images/content.
  window.addEventListener("dragstart", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "IMG" || t.tagName === "svg")) e.preventDefault();
  });
}

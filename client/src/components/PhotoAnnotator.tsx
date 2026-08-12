/**
 * PhotoAnnotator.tsx — Non-destructive canvas overlay on a photo.
 *
 * Placeholder shell — full arrow/circle/text tools land in commit 2.
 * Renders the image + any existing annotationsJson so the file compiles
 * and existing tiles that reference the annotator won't crash.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Save } from "lucide-react";
import type { Photo } from "@shared/schema";

interface Props {
  photo: Photo;
  onClose: () => void;
  onSave: (annotationsJson: string) => Promise<void> | void;
}

// TODO(commit 2): draw arrows, circles, freehand, text, moisture badges.
// Persists as JSON so we never touch the original bytes.
export default function PhotoAnnotator({ photo, onClose, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const initial = (photo as any).annotationsJson || "{\"shapes\":[]}";
  const [json] = useState<string>(initial);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-semibold">Annotate photo</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => { setSaving(true); try { await onSave(json); } finally { setSaving(false); onClose(); } }}>
              <Save className="w-4 h-4 mr-1"/>Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4"/></Button>
          </div>
        </div>
        <div className="p-3">
          <img src={(photo as any).dataUrl} alt="" className="max-w-full h-auto rounded"/>
          <p className="text-xs text-gray-500 mt-2">Drawing tools land in the next update. Annotations you make will save with the photo without altering the original.</p>
        </div>
      </div>
    </div>
  );
}

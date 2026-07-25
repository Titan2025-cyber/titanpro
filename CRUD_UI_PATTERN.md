# Edit/Delete UI Pattern — Titan Pro (follow EXACTLY)

You are adding **edit** and **delete** controls to existing module pages. The backend
already supports `PATCH /api/<resource>/:id` and `DELETE /api/<resource>/:id` for every
resource listed in your assignment. Do NOT change the backend. Do NOT touch any file
outside your assigned pages. This is ADDITIVE — do not alter existing layout, styling,
colors, or unrelated features. Match the surrounding code style of each page.

## Hard rules
- **Additive only.** Preserve all existing UI. Add controls next to existing per-row/per-card actions, or create an actions column/menu if none exists.
- **Never** use `localStorage`, `sessionStorage`, `indexedDB`, `requestFullscreen`, `requestPointerLock` — the deploy scanner BLOCKS these tokens.
- Use `apiRequest` and `queryClient` from `@/lib/queryClient`. NEVER raw `fetch()`.
- Use `useToast` from `@/hooks/use-toast` for success/error toasts.
- After any mutation, call `queryClient.invalidateQueries({ queryKey: [<the list queryKey used on this page>] })`. Find the actual queryKey the page already uses for its list query and reuse it EXACTLY (often `["/api/<resource>"]`).
- Add `data-testid` to every new interactive element:
  - Delete trigger: `button-delete-<resource>-${id}`
  - Delete confirm: `button-confirm-delete-<resource>-${id}`
  - Edit trigger: `button-edit-<resource>-${id}`
  - Edit save: `button-save-<resource>-${id}`
  - Edit fields: `input-<field>-${id}`
- Keep TypeScript happy: reuse the page's existing row/item type if defined; otherwise use a local `any`-typed handler is acceptable to avoid churn, but prefer the existing type.

## DELETE pattern (use shadcn AlertDialog — already available in the project)
Import if not present:
```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
```

Component (adapt `RESOURCE`, `queryKey`, label field):
```tsx
function DeleteBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/RESOURCE/${id}`),
    onSuccess: () => { toast({ title: "Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-RESOURCE-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this record?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-RESOURCE-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```
Wire `onDone` to `() => queryClient.invalidateQueries({ queryKey: [<list key>] })`.

## EDIT pattern (only where the page has no edit UI already)
Reuse the page's existing "Add" dialog if there is one — clone it into an Edit dialog
pre-filled with the row's values, and PATCH instead of POST:
```tsx
const m = useMutation({
  mutationFn: (data: any) => apiRequest("PATCH", `/api/RESOURCE/${id}`, data),
  onSuccess: () => { toast({ title: "Saved" }); queryClient.invalidateQueries({ queryKey: [LISTKEY] }); setOpen(false); },
  onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
});
```
Only send the editable fields the page's Add form already uses. Keep it simple — you do
NOT need every column, just the ones a user would reasonably edit (mirror the Add form).

If a page ALREADY has an edit dialog/mutation (PATCH present), only add DELETE.

## After editing
- Do a quick self-check that imports resolve (Button, useMutation, apiRequest, queryClient, useToast, AlertDialog, Trash2, Pencil).
- Do NOT run the build yourself; the main agent will build and QA. Just make clean, consistent edits.
- Report exactly which files you changed and what you added per file.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * CarrierSelect — controlled select for insurance carriers.
 *
 * Why this exists: the free-text carrier input on the Job Detail insurance
 * tab (and the New Job form) was creating duplicate rows on the Carrier
 * Scorecard whenever two adjusters typed the name differently — "State
 * Farm" vs "Statefarm" vs "State Farm Ins" became three carriers on the
 * scorecard. This component reads the /api/insurance-carriers directory
 * and always writes a canonical name back, so scorecard grouping stays
 * clean. Users can still add a new carrier via the inline dialog; the
 * server dedupes case-insensitively.
 *
 * The current value is always shown even if it isn't in the active list
 * yet (legacy jobs), so nothing looks blank until saved.
 */
export function CarrierSelect({
  value,
  onChange,
  placeholder = "Select carrier…",
  testId = "select-insurance-carrier",
  disabled,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: carriers = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/insurance-carriers"],
    queryFn: () => apiRequest("GET", "/api/insurance-carriers").then((r) => r.json()),
    staleTime: 60_000,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // Ensure the current value is always represented in the dropdown, even if
  // it hasn't been added to the directory yet (e.g. a legacy job that was
  // typed in before this feature existed). Case-insensitive check.
  const options = useMemo(() => {
    const names = carriers.map((c) => c.name);
    if (value && !names.some((n) => n.toLowerCase() === value.toLowerCase())) {
      return [value, ...names];
    }
    return names;
  }, [carriers, value]);

  const addMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/insurance-carriers", { name }).then((r) => r.json()),
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ["/api/insurance-carriers"] });
      if (created?.name) onChange(created.name);
      setAddOpen(false);
      setNewName("");
      toast({ title: "Carrier added" });
    },
    onError: (e: any) =>
      toast({ title: "Add failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // Special sentinel value that opens the "Add new" dialog instead of
  // selecting a real option. Chosen so it can't clash with a real carrier.
  const ADD_SENTINEL = "__add_new__";

  return (
    <>
      <Select
        value={value || ""}
        onValueChange={(v) => {
          if (v === ADD_SENTINEL) {
            setAddOpen(true);
            return;
          }
          onChange(v);
        }}
        disabled={disabled}
      >
        <SelectTrigger data-testid={testId}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((name) => (
            <SelectItem key={name} value={name}>{name}</SelectItem>
          ))}
          <SelectItem value={ADD_SENTINEL} className="text-[hsl(var(--titan-blue))] font-medium">
            + Add new carrier…
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add insurance carrier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Carrier name</Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. State Farm"
                data-testid="input-new-carrier-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) addMutation.mutate(newName.trim());
                }}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Duplicates are prevented — if the name already exists it will be selected.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                disabled={!newName.trim() || addMutation.isPending}
                onClick={() => addMutation.mutate(newName.trim())}
                data-testid="button-save-new-carrier"
              >
                {addMutation.isPending ? "Saving…" : "Add carrier"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

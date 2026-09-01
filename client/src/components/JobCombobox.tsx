import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Job } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// JobCombobox
//
// Replaces the plain <Select> job pickers on the New Estimate and New Invoice
// dialogs so users can search by job number, loss type, address, or the
// customer/contact name attached to the job instead of scrolling a long list.
//
// - Case-insensitive match across all searchable fields
// - Keyboard-friendly (cmdk under the hood)
// - Shows job number as primary, with loss type + address as secondary line
// - Renders "No jobs found" empty state
// - Trigger fills its parent width so it drops into forms cleanly
// ─────────────────────────────────────────────────────────────────────────────

type ContactLite = { id: number; name?: string | null };

type Props = {
  jobs: Job[];
  contacts?: ContactLite[];        // optional; enables customer-name search
  value: string;                    // job id as string, or "" for none
  onChange: (jobId: string) => void;
  placeholder?: string;
  emptyText?: string;
  "data-testid"?: string;
};

export default function JobCombobox({
  jobs,
  contacts = [],
  value,
  onChange,
  placeholder = "Search jobs by number, address, loss type…",
  emptyText = "No jobs found.",
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);

  // Precompute a searchable haystack per job so cmdk's filter (which reads the
  // `value` prop on each item) can match across many fields with one string.
  const rows = useMemo(() => {
    return jobs.map(j => {
      const contact = contacts.find(c => c.id === (j as any).contactId);
      const parts = [
        j.jobNumber,
        (j as any).lossType,
        (j as any).address,
        (j as any).streetAddress,
        (j as any).city,
        (j as any).state,
        (j as any).zip,
        (j as any).status,
        contact?.name || "",
      ].filter(Boolean);
      return {
        job: j,
        contactName: contact?.name || "",
        haystack: parts.join(" ").toLowerCase(),
      };
    });
  }, [jobs, contacts]);

  const selected = rows.find(r => String(r.job.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={rest["data-testid"] || "job-combobox-trigger"}
        >
          {selected ? (
            <span className="truncate text-left">
              <span className="font-medium">{selected.job.jobNumber}</span>
              {selected.job.lossType ? (
                <span className="text-muted-foreground"> · {selected.job.lossType}</span>
              ) : null}
              {selected.contactName ? (
                <span className="text-muted-foreground"> · {selected.contactName}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground flex items-center">
              <Search className="w-3.5 h-3.5 mr-2" />
              {placeholder}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command
          filter={(itemValue, search) => {
            // itemValue is the haystack we passed to CommandItem's `value`.
            // Split search into tokens so "aug 0421" matches "TP-2026-Augusta-0421".
            const hay = itemValue.toLowerCase();
            const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
            if (!tokens.length) return 1;
            return tokens.every(t => hay.includes(t)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search jobs…" data-testid="job-combobox-search" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {rows.map(r => (
                <CommandItem
                  key={r.job.id}
                  value={r.haystack}
                  onSelect={() => {
                    onChange(String(r.job.id));
                    setOpen(false);
                  }}
                  data-testid={`job-combobox-option-${r.job.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === String(r.job.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {r.job.jobNumber}
                      {r.job.lossType ? (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          {r.job.lossType}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[r.contactName, (r.job as any).address].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

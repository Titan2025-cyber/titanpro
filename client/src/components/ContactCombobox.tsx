import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Contact = {
  id: number;
  name: string;
  type: "customer" | "sub" | "referral";
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
};

/**
 * ContactCombobox — searchable contact picker.
 *
 * Replaces the old scroll-only <Select> pickers on the New Job form
 * (customer + referring partner). Text search filters by name, company,
 * phone, or email so operators can find a contact in one keystroke
 * instead of scrolling. Clears with the X button.
 *
 * Filter `type` scopes to a single kind: "customer", "sub", or "referral".
 * Omit for all contacts.
 *
 * Value is a stringified contact id (or "") to match the shape most of our
 * form state already uses.
 */
export function ContactCombobox({
  value,
  onChange,
  type,
  placeholder = "Select contact…",
  emptyLabel = "No contacts match.",
  testId,
  disabled,
  allowClear = true,
}: {
  value: string;
  onChange: (id: string) => void;
  type?: Contact["type"];
  placeholder?: string;
  emptyLabel?: string;
  testId?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: () => apiRequest("GET", "/api/contacts").then((r) => r.json()),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const list = contacts.filter((c) => (c.status ?? "active") !== "archived");
    return type ? list.filter((c) => c.type === type) : list;
  }, [contacts, type]);

  const selected = filtered.find((c) => String(c.id) === value);

  return (
    <Popover open={open} onOpenChange={disabled ? () => {} : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
          )}
          data-testid={testId}
        >
          <span className="truncate">
            {selected
              ? selected.company
                ? `${selected.name} — ${selected.company}`
                : selected.name
              : placeholder}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {allowClear && selected && (
              <span
                role="button"
                aria-label="Clear selection"
                className="rounded p-0.5 hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
              >
                <X className="h-3.5 w-3.5 opacity-60" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,90vw)] p-0" align="start">
        <Command
          // Custom filter that searches name, company, phone, email.
          filter={(itemValue, search) => {
            if (!search) return 1;
            const contact = filtered.find((c) => String(c.id) === itemValue);
            if (!contact) return 0;
            const hay = `${contact.name} ${contact.company ?? ""} ${contact.phone ?? ""} ${contact.email ?? ""}`.toLowerCase();
            return hay.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search name, company, phone…" />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {filtered.map((c) => (
                <CommandItem
                  key={c.id}
                  value={String(c.id)}
                  onSelect={(v) => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === String(c.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm">{c.name}</div>
                    {(c.company || c.phone) && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {[c.company, c.phone].filter(Boolean).join(" · ")}
                      </div>
                    )}
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

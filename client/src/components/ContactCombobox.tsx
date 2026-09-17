import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneInput } from "@/lib/phone";

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
  allowCreate = false,
}: {
  value: string;
  onChange: (id: string) => void;
  type?: Contact["type"];
  placeholder?: string;
  emptyLabel?: string;
  testId?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /**
   * Push 11: when `true` AND a `type` is scoped, show an inline
   * "+ Add new <type>" affordance inside the popover. The typed search
   * pre-fills the new-contact dialog's Name field so a lead intaker can
   * capture a fresh referral partner without leaving the New Job form.
   * Auto-selects the new contact on save. Only enabled when `type` is
   * set so we don't create contacts with ambiguous type=customer defaults.
   */
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", company: "", phone: "", email: "" });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: () => apiRequest("GET", "/api/contacts").then((r) => r.json()),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const list = contacts.filter((c) => (c.status ?? "active") !== "archived");
    return type ? list.filter((c) => c.type === type) : list;
  }, [contacts, type]);

  // Show the create row when: create is enabled, a type is scoped, and
  // no exact-name match (case-insensitive) exists for the current search.
  // An exact-match hit means the operator already has the contact — no
  // need to offer creating a duplicate.
  const trimmedSearch = search.trim();
  const hasExactMatch = trimmedSearch.length > 0 && filtered.some(
    (c) => c.name.toLowerCase() === trimmedSearch.toLowerCase(),
  );
  const canCreate = allowCreate && !!type && !disabled;
  const showCreateRow = canCreate && (trimmedSearch.length > 0 ? !hasExactMatch : true);

  const typeLabel = type === "referral" ? "referral partner"
    : type === "sub" ? "subcontractor"
    : type === "customer" ? "customer"
    : "contact";

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!type) throw new Error("Type required for inline create.");
      const name = draft.name.trim();
      if (!name) throw new Error("Name is required.");
      const res = await apiRequest("POST", "/api/contacts", {
        name,
        type,
        company: draft.company.trim() || null,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        status: "active",
      });
      return res.json() as Promise<Contact>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      onChange(String(created.id));
      setCreateOpen(false);
      setOpen(false);
      setDraft({ name: "", company: "", phone: "", email: "" });
      setSearch("");
      toast({ title: `${typeLabel[0].toUpperCase() + typeLabel.slice(1)} added`, description: created.name });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't add", description: err?.message || "Try again.", variant: "destructive" });
    },
  });

  const openCreateDialog = () => {
    setDraft({ name: trimmedSearch, company: "", phone: "", email: "" });
    setCreateOpen(true);
  };

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
          filter={(itemValue, s) => {
            if (!s) return 1;
            const contact = filtered.find((c) => String(c.id) === itemValue);
            if (!contact) return 0;
            const hay = `${contact.name} ${contact.company ?? ""} ${contact.phone ?? ""} ${contact.email ?? ""}`.toLowerCase();
            return hay.includes(s.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Search name, company, phone…"
            value={search}
            onValueChange={setSearch}
          />
          {/* Cap the visible list so a long partner roster becomes scrollable
              instead of pushing the create-row off-screen. */}
          <CommandList className="max-h-[280px]">
            <CommandEmpty>
              {showCreateRow ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-2 text-sm text-left hover:bg-accent rounded"
                  onClick={openCreateDialog}
                  data-testid="combobox-add-inline"
                >
                  <Plus className="h-4 w-4" />
                  <span>
                    Add {trimmedSearch ? <strong>“{trimmedSearch}”</strong> : "a"} as new {typeLabel}
                  </span>
                </button>
              ) : (
                emptyLabel
              )}
            </CommandEmpty>
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
              {/* Also render the create row at the bottom of a non-empty list,
                  so an operator can add "John Smith" even when "Johnny Smith"
                  already exists. Hidden when the search exactly matches an
                  existing name to prevent obvious duplicates. */}
              {showCreateRow && filtered.length > 0 && (
                <CommandItem
                  value={`__create__${trimmedSearch || "new"}`}
                  onSelect={openCreateDialog}
                  className="border-t mt-1 pt-2 text-primary"
                  data-testid="combobox-add-inline-bottom"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="text-sm">
                    Add {trimmedSearch ? <strong>“{trimmedSearch}”</strong> : "a new"} {typeLabel}
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>

      {/* Inline-create dialog. Rendered inside the outer Popover component
          but visually detached; opens on top so the operator can capture
          minimum contact detail (name required, everything else optional).
          Auto-selects the new contact on save. */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add {typeLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                className="mt-1 h-9"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Full name"
                autoFocus
                data-testid="input-inline-contact-name"
              />
            </div>
            <div>
              <Label className="text-xs">Company</Label>
              <Input
                className="mt-1 h-9"
                value={draft.company}
                onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                placeholder="Firm, agency, or brokerage"
                data-testid="input-inline-contact-company"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Phone</Label>
                <Input
                  className="mt-1 h-9"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: formatPhoneInput(e.target.value) }))}
                  placeholder="(555) 555-1234"
                  inputMode="tel"
                  data-testid="input-inline-contact-phone"
                />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  className="mt-1 h-9"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  placeholder="name@company.com"
                  data-testid="input-inline-contact-email"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              You can finish this profile later under Contacts. Only the name is required now.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !draft.name.trim()}
              data-testid="button-inline-contact-save"
            >
              {createMutation.isPending ? "Saving…" : `Save & select`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Popover>
  );
}

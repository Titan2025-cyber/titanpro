import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, Minus, ShoppingCart } from "lucide-react";

// Item shape returned by /api/line-items.
export type PriceItem = {
  id: number;
  category: string;
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
  notes?: string;
};

// The picker returns a flat list of these to the caller — the caller adds
// them to whatever collection it owns (estimate line items, invoice line
// items, purchase order, etc). Keeping the callback dumb means one component
// serves every consumer.
export type PickedItem = {
  category: string;
  code?: string;
  description: string;
  unit: string;
  unitPrice: number;
  qty: number;
  notes?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (items: PickedItem[]) => void;
  // Category to preselect when the picker opens. When null, the first
  // category in the library becomes the active tab.
  initialCategory?: string | null;
  title?: string;
}

// ── Cart state ──────────────────────────────────────────────────────────────
// We keep a { id -> qty } map so a user can jump between categories, tick
// items in each, and see one running "Add N items" button. Committing the
// cart calls onAdd once with the flat list.
export default function PriceListPicker({ open, onOpenChange, onAdd, initialCategory, title }: Props) {
  const [activeCat, setActiveCat] = useState<string>("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({}); // itemId -> qty

  const { data: items = [] } = useQuery<PriceItem[]>({ queryKey: ["/api/line-items"], enabled: open });
  const { data: categories = [] } = useQuery<string[]>({ queryKey: ["/api/line-items/categories"], enabled: open });

  // Reset cart + focus initial category whenever the dialog opens fresh.
  useEffect(() => {
    if (!open) return;
    setCart({});
    setSearch("");
    if (initialCategory && categories.includes(initialCategory)) setActiveCat(initialCategory);
    else if (categories.length && !categories.includes(activeCat)) setActiveCat(categories[0]);
  }, [open, categories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const inCategory = useMemo(() => {
    return items.filter(it => it.category === activeCat);
  }, [items, activeCat]);

  const visible = useMemo(() => {
    if (!search) return inCategory;
    const s = search.toLowerCase();
    return inCategory.filter(it =>
      it.description.toLowerCase().includes(s) ||
      (it.code || "").toLowerCase().includes(s)
    );
  }, [inCategory, search]);

  const cartCount = Object.values(cart).filter(q => q > 0).length;
  const cartQty = Object.values(cart).reduce((s, q) => s + (q > 0 ? q : 0), 0);
  const cartTotal = useMemo(() => {
    let total = 0;
    for (const [id, qty] of Object.entries(cart)) {
      const it = items.find(x => x.id === Number(id));
      if (it && qty > 0) total += it.unitPrice * qty;
    }
    return total;
  }, [cart, items]);

  const bump = (id: number, delta: number) => setCart(c => {
    const cur = c[id] || 0;
    const next = Math.max(0, cur + delta);
    const out = { ...c };
    if (next === 0) delete out[id]; else out[id] = next;
    return out;
  });
  const setQty = (id: number, qty: number) => setCart(c => {
    const out = { ...c };
    const q = Math.max(0, Math.round(Number.isFinite(qty) ? qty : 0));
    if (q === 0) delete out[id]; else out[id] = q;
    return out;
  });
  const quickAdd = (id: number) => setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 }));

  const commit = () => {
    const picked: PickedItem[] = [];
    for (const [idStr, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const it = items.find(x => x.id === Number(idStr));
      if (!it) continue;
      picked.push({
        category: it.category,
        code: it.code || undefined,
        description: it.description,
        unit: it.unit,
        unitPrice: it.unitPrice,
        qty,
        notes: it.notes || undefined,
      });
    }
    if (!picked.length) { onOpenChange(false); return; }
    onAdd(picked);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" /> {title || "Add from Price List"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Pick a category, quick-add every line item you need, then switch to another category for more. Nothing is added to the estimate until you click <strong>Done</strong>.
          </p>
        </DialogHeader>

        {items.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            The price list is empty. Ask an admin to upload one in Settings → Price Lists.
          </div>
        ) : (
          <>
            {/* Category tabs */}
            <div className="px-6 pt-3 pb-2 border-b flex flex-wrap gap-2">
              {categories.map(cat => {
                const count = items.filter(i => i.category === cat).length;
                const pickedInCat = Object.entries(cart).filter(([id, q]) => q > 0 && items.find(x => x.id === Number(id))?.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCat(cat)}
                    className={`px-3 py-1.5 rounded-md text-sm border relative ${activeCat === cat ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
                    data-testid={`picker-tab-${cat}`}
                  >
                    {cat} <span className="opacity-70">({count})</span>
                    {pickedInCat > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-xs font-semibold">
                        {pickedInCat}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="px-6 py-2 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder={`Search ${activeCat}…`} value={search} onChange={e => setSearch(e.target.value)} data-testid="picker-search" />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto px-6 py-3">
              {visible.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No items {search ? "match your search" : "in this category"}.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left px-2 py-2 w-24">Code</th>
                      <th className="text-left px-2 py-2">Description</th>
                      <th className="text-left px-2 py-2 w-16">Unit</th>
                      <th className="text-right px-2 py-2 w-24">Price</th>
                      <th className="text-center px-2 py-2 w-36">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(it => {
                      const qty = cart[it.id] || 0;
                      return (
                        <tr key={it.id} className={`border-b ${qty > 0 ? "bg-primary/5" : "hover:bg-muted/20"}`} data-testid={`picker-row-${it.id}`}>
                          <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{it.code || "—"}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium">{it.description}</div>
                            {it.notes && <div className="text-xs text-muted-foreground">{it.notes}</div>}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">{it.unit}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">${it.unitPrice.toFixed(2)}</td>
                          <td className="px-2 py-2">
                            {qty === 0 ? (
                              <div className="flex justify-center">
                                <Button size="sm" variant="outline" onClick={() => quickAdd(it.id)} data-testid={`picker-add-${it.id}`}>
                                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => bump(it.id, -1)}><Minus className="w-3.5 h-3.5" /></Button>
                                <input
                                  type="number" min={0} step={1}
                                  className="w-14 text-center border rounded h-8 tabular-nums"
                                  value={qty}
                                  onChange={e => setQty(it.id, Number(e.target.value))}
                                  data-testid={`picker-qty-${it.id}`}
                                />
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => bump(it.id, 1)}><Plus className="w-3.5 h-3.5" /></Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer / cart summary */}
            <div className="border-t px-6 py-3 flex items-center justify-between gap-3 bg-muted/20">
              <div className="text-sm">
                {cartCount === 0 ? (
                  <span className="text-muted-foreground">No items selected yet — pick from any category, then click Done.</span>
                ) : (
                  <>
                    <strong className="text-foreground">{cartCount}</strong> item{cartCount === 1 ? "" : "s"} <span className="text-muted-foreground">·</span>{" "}
                    <strong className="text-foreground">{cartQty}</strong> total qty <span className="text-muted-foreground">·</span>{" "}
                    <strong className="text-foreground">${cartTotal.toFixed(2)}</strong>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={commit} disabled={cartCount === 0} data-testid="picker-done">
                  Done — Add {cartCount || ""} to Estimate
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

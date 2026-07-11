import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Target, TrendingDown, BarChart3, AlertCircle, Plus } from "lucide-react";

const SAMPLE_LOSSES = [
  { zip: "29803", competitor: "ABC Restoration", lossType: "water", count: 4, estimatedBid: 6800, yourAvg: 7200, quarter: "Q2 2026" },
  { zip: "29201", competitor: "Carolina Restore", lossType: "mold", count: 2, estimatedBid: 12000, yourAvg: 13500, quarter: "Q2 2026" },
  { zip: "29841", competitor: "Masters Restoration", lossType: "fire", count: 1, estimatedBid: 28000, yourAvg: 31000, quarter: "Q2 2026" },
];

export default function CompetitiveBidIntel() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ zip: "", competitor: "", lossType: "water", reason: "", estimatedBid: "" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Competitive Bid Intelligence</h1>
            <p className="text-sm text-muted-foreground">Win/loss tracking by ZIP, loss type, and competitor — market insight from your own data</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90">
          <Plus className="w-4 h-4 mr-1" />Log Lost Bid
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Log a Lost Bid</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">ZIP Code</Label><Input value={form.zip} onChange={e=>setForm(f=>({...f,zip:e.target.value}))} placeholder="29803" /></div>
            <div><Label className="text-xs">Competitor (optional)</Label><Input value={form.competitor} onChange={e=>setForm(f=>({...f,competitor:e.target.value}))} placeholder="ABC Restoration" /></div>
            <div><Label className="text-xs">Loss Type</Label>
              <Select value={form.lossType} onValueChange={v=>setForm(f=>({...f,lossType:v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["water","fire","mold","storm","biohazard"].map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Est. Competitor Bid</Label><Input type="number" value={form.estimatedBid} onChange={e=>setForm(f=>({...f,estimatedBid:e.target.value}))} placeholder="6500" /></div>
            <div className="col-span-2"><Label className="text-xs">Reason Lost (optional)</Label><Input value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} placeholder="Price, timing, referral relationship…" /></div>
            <div className="col-span-2 flex gap-2">
              <Button size="sm" className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90">Save</Button>
              <Button size="sm" variant="outline" onClick={()=>setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Bids Lost This Quarter", value: String(SAMPLE_LOSSES.reduce((s,l)=>s+l.count,0)), sub: "7 tracked losses" },
          { label: "Avg Price Differential", value: "−6%", sub: "below competitor avg" },
          { label: "Top Competitor ZIP", value: "29803", sub: "4 losses to ABC Restoration" },
        ].map(s => (
          <Card key={s.label}><CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium">{s.label}</p>
            <p className="text-[10px] text-muted-foreground">{s.sub}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" />Loss Patterns by ZIP & Competitor</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {SAMPLE_LOSSES.map((l, i) => (
            <div key={i} className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{l.zip}</Badge>
                  <span className="text-sm font-medium">{l.count} loss{l.count>1?"es":""} to {l.competitor || "unknown"}</span>
                  <Badge variant="outline" className="text-xs capitalize">{l.lossType}</Badge>
                </div>
                <Badge variant="outline" className="text-xs">{l.quarter}</Badge>
              </div>
              <div className="flex gap-4 text-xs">
                <div><span className="text-muted-foreground">Their est. bid: </span><span className="font-medium">${l.estimatedBid.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Your avg: </span><span className="font-medium">${l.yourAvg.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Gap: </span><span className="font-medium text-red-500">+${(l.yourAvg-l.estimatedBid).toLocaleString()}</span></div>
              </div>
              <p className="text-xs text-muted-foreground italic">
                💡 Consider adjusting scope presentation for {l.lossType} losses in ZIP {l.zip} — competitor pricing {Math.round(((l.yourAvg-l.estimatedBid)/l.yourAvg)*100)}% below yours.
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

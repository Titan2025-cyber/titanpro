import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, Clock, TrendingDown, Phone, Mail, Star, BarChart2 } from "lucide-react";

const SAMPLE_PROFILES = [
  { name: "Tom Bradley", carrier: "State Farm", avgResponseDays: 12, avgCutPct: 18, preferredContact: "Phone", hotItems: ["Antimicrobial","O&P"], winItems: ["Demo","Structure"], claimsHandled: 8, rating: 4 },
  { name: "Sarah Chen", carrier: "Allstate", avgResponseDays: 7, avgCutPct: 28, preferredContact: "Email", hotItems: ["Pack-Out","Contents"], winItems: ["Equipment","Drying"], claimsHandled: 5, rating: 3 },
  { name: "Mike Torres", carrier: "Nationwide", avgResponseDays: 18, avgCutPct: 12, preferredContact: "Phone", hotItems: ["Air Movers"], winItems: ["Full scope"], claimsHandled: 6, rating: 5 },
];

export default function AdjusterProfiler() {
  const { data: adjusters = [] } = useQuery<any[]>({ queryKey: ["/api/adjusters"], queryFn: () => apiRequest("GET", "/api/adjusters").then(r => r.json()) });
  const [search, setSearch] = useState("");

  const displayed = [...SAMPLE_PROFILES, ...(adjusters as any[]).map((a:any) => ({
    name: a.name, carrier: a.carrier, avgResponseDays: a.avgResponseDays || 14, avgCutPct: 20,
    preferredContact: "Phone", hotItems: [], winItems: [], claimsHandled: 0, rating: 3
  }))].filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.carrier?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <User className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Adjuster Behavioral Profiling</h1>
          <p className="text-sm text-muted-foreground">Per-adjuster outcome history — know how they behave before they touch your file</p>
        </div>
      </div>

      <Input placeholder="Search adjuster name or carrier…" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayed.map((adj, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><User className="w-4 h-4 text-[hsl(var(--titan-blue))]" />{adj.name}</span>
                <div className="flex">
                  {[1,2,3,4,5].map(s => <Star key={s} className={`w-3 h-3 ${s <= adj.rating ? "text-amber-400 fill-amber-400" : "text-muted-foreground"}`} />)}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <Badge variant="outline">{adj.carrier}</Badge>
                <span className="text-muted-foreground">{adj.claimsHandled} claims handled</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-1.5 rounded bg-muted/30">
                  <p className="font-bold">{adj.avgResponseDays}d</p>
                  <p className="text-muted-foreground">Avg Response</p>
                </div>
                <div className="p-1.5 rounded bg-muted/30">
                  <p className="font-bold text-red-500">−{adj.avgCutPct}%</p>
                  <p className="text-muted-foreground">Avg Cut</p>
                </div>
                <div className="p-1.5 rounded bg-muted/30">
                  <p className="font-bold">{adj.preferredContact === "Phone" ? "📞" : "📧"}</p>
                  <p className="text-muted-foreground">{adj.preferredContact}</p>
                </div>
              </div>
              {adj.hotItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-red-500 mb-1">Typically Cuts</p>
                  <div className="flex flex-wrap gap-1">{adj.hotItems.map((item:string) => <Badge key={item} variant="outline" className="text-[10px] border-red-200 text-red-600">{item}</Badge>)}</div>
                </div>
              )}
              {adj.winItems.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-green-600 mb-1">Usually Approves</p>
                  <div className="flex flex-wrap gap-1">{adj.winItems.map((item:string) => <Badge key={item} variant="outline" className="text-[10px] border-green-200 text-green-600">{item}</Badge>)}</div>
                </div>
              )}
              <Button size="sm" variant="outline" className="w-full text-xs h-7">View Full Profile</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

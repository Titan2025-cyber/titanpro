import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, FileText, Save, Sparkles, Volume2 } from "lucide-react";

export default function VoiceToNote() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const [selectedJob, setSelectedJob] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [structuredNote, setStructuredNote] = useState("");
  const [visibility, setVisibility] = useState<"public"|"private">("private");

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      // Simulate transcription result
      const sample = "Room 2 living room moisture reading 22 percent on the drywall near the window. Placed two air movers and one dehu. Temperature 74 degrees GPP 68. Category 2 water damage from supply line failure.";
      setTranscript(sample);
      setStructuredNote(`Room: Living Room (Room 2)\nCondition: Category 2 water damage — supply line failure\nMoisture: 22% WME (drywall, near window)\nPsychometrics: 74°F · GPP 68\nEquipment Placed: 2× air movers, 1× dehumidifier\nAction: Daily monitoring, next reading in 24h`);
    } else {
      setRecording(true);
      setTranscript("");
      setStructuredNote("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <Mic className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Voice-to-Job-Note</h1>
          <p className="text-sm text-muted-foreground">Field dictation — speak your note, AI structures and attaches it to the job file</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Job</CardTitle></CardHeader>
          <CardContent>
            <Select value={selectedJob} onValueChange={setSelectedJob}>
              <SelectTrigger><SelectValue placeholder="Select job…" /></SelectTrigger>
              <SelectContent>
                {(jobs as any[]).map((j:any) => (
                  <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4,"0")} — {j.address?.split(",")[0]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Visibility</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Button size="sm" variant={visibility==="private"?"default":"outline"} onClick={()=>setVisibility("private")} className={visibility==="private"?"bg-[hsl(var(--titan-red))] text-white":""}>Private (Internal Only)</Button>
            <Button size="sm" variant={visibility==="public"?"default":"outline"} onClick={()=>setVisibility("public")} className={visibility==="public"?"bg-[hsl(var(--titan-blue))] text-white":""}>Public (Customer Visible)</Button>
          </CardContent>
        </Card>
      </div>

      {/* Record button */}
      <Card>
        <CardContent className="pt-6 flex flex-col items-center gap-4">
          <button
            onClick={toggleRecording}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-lg ${recording ? "bg-red-500 animate-pulse scale-110" : "bg-[hsl(var(--titan-blue))] hover:scale-105"}`}
          >
            {recording ? <MicOff className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
          </button>
          <p className="text-sm text-muted-foreground">
            {recording ? "🔴 Recording… tap to stop" : "Tap to start recording your field note"}
          </p>
          {recording && (
            <div className="flex gap-1">
              {[1,2,3,4,5,4,3,2,1,2,3].map((h,i) => (
                <div key={i} className="w-1 bg-red-400 rounded-full animate-pulse" style={{ height: `${h*6}px`, animationDelay: `${i*0.1}s` }} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {transcript && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Volume2 className="w-4 h-4" />Transcript</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground italic">"{transcript}"</p>
          </CardContent>
        </Card>
      )}

      {structuredNote && (
        <Card className="border-green-300">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-green-600" />AI-Structured Note</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={6} value={structuredNote} onChange={e=>setStructuredNote(e.target.value)} className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button size="sm" className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90 text-xs" disabled={!selectedJob}>
                <Save className="w-3 h-3 mr-1" />Save to Job File
              </Button>
              <Badge variant="outline" className={`text-xs ${visibility==="public"?"border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))]":"border-muted-foreground"}`}>
                {visibility === "public" ? "👁 Customer visible" : "🔒 Internal only"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

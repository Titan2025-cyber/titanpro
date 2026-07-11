import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, AlertTriangle, CheckCircle, Thermometer, Droplets, Activity, TrendingDown } from "lucide-react";

export default function IoTDryingDashboard() {
  const qc = useQueryClient();
  const [showAddSensor, setShowAddSensor] = useState(false);
  const [showAddReading, setShowAddReading] = useState<number | null>(null);
  const [showPrediction, setShowPrediction] = useState<number | null>(null);
  const [sensorForm, setSensorForm] = useState({ jobId: "", sensorId: "", brand: "manual", location: "", material: "drywall", targetWme: "16" });
  const [readingForm, setReadingForm] = useState({ wme: "", tempF: "", rhPct: "" });
  const [prediction, setPrediction] = useState<any>(null);

  const { data: sensors = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/iot-sensors"], queryFn: () => apiRequest("/api/iot-sensors").then(r => r.json()) });
  const { data: readings = [] } = useQuery<any[]>({ queryKey: ["/api/iot-readings"], queryFn: () => apiRequest("/api/iot-readings").then(r => r.json()) });

  const addSensor = useMutation({
    mutationFn: (d: any) => apiRequest("/api/iot-sensors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/iot-sensors"] }); setShowAddSensor(false); },
  });
  const deleteSensor = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/iot-sensors/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/iot-sensors"] }),
  });
  const addReading = useMutation({
    mutationFn: ({ sensorId, jobId, data }: any) => apiRequest("/api/iot-readings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sensorId, jobId, ...data }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/iot-readings"] }); setShowAddReading(null); setReadingForm({ wme: "", tempF: "", rhPct: "" }); },
  });

  const fetchPrediction = async (sensorId: number) => {
    const data = await apiRequest(`/api/iot-sensors/${sensorId}/predict`).then(r => r.json());
    setPrediction(data);
    setShowPrediction(sensorId);
  };

  const alertSensors = sensors.filter(s => {
    const latestReading = readings.filter((r: any) => r.sensor_id === s.id).sort((a: any, b: any) => new Date(b.reading_at).getTime() - new Date(a.reading_at).getTime())[0];
    return latestReading?.is_alert;
  });

  const getLatestReading = (sensorId: number) => readings.filter((r: any) => r.sensor_id === sensorId).sort((a: any, b: any) => new Date(b.reading_at).getTime() - new Date(a.reading_at).getTime())[0];
  const getSensorReadingHistory = (sensorId: number) => readings.filter((r: any) => r.sensor_id === sensorId).sort((a: any, b: any) => new Date(a.reading_at).getTime() - new Date(b.reading_at).getTime());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">IoT Drying Dashboard</h1>
          <p className="text-sm text-muted-foreground">Continuous moisture monitoring + predictive dry-out per IICRC S500</p>
        </div>
        <Dialog open={showAddSensor} onOpenChange={setShowAddSensor}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-add-sensor"><Plus className="w-4 h-4 mr-2" />Add Sensor</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Moisture Sensor</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Job ID" value={sensorForm.jobId} onChange={e => setSensorForm(f => ({ ...f, jobId: e.target.value }))} data-testid="input-job-id" />
              <Input placeholder="Sensor ID / serial number" value={sensorForm.sensorId} onChange={e => setSensorForm(f => ({ ...f, sensorId: e.target.value }))} data-testid="input-sensor-id" />
              <Input placeholder="Location (e.g. Kitchen Wall North)" value={sensorForm.location} onChange={e => setSensorForm(f => ({ ...f, location: e.target.value }))} data-testid="input-location" />
              <div className="grid grid-cols-2 gap-2">
                <Select value={sensorForm.brand} onValueChange={v => setSensorForm(f => ({ ...f, brand: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual Entry</SelectItem>
                    <SelectItem value="tramex">Tramex</SelectItem>
                    <SelectItem value="omnisense">Omnisense DriFi</SelectItem>
                    <SelectItem value="govee">Govee Pro</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sensorForm.material} onValueChange={v => setSensorForm(f => ({ ...f, material: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="drywall">Drywall</SelectItem>
                    <SelectItem value="subfloor">Subfloor</SelectItem>
                    <SelectItem value="concrete">Concrete</SelectItem>
                    <SelectItem value="wood">Wood</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Target WME % (IICRC S500 — default 16% for drywall)</p>
                <Input type="number" step="0.5" value={sensorForm.targetWme} onChange={e => setSensorForm(f => ({ ...f, targetWme: e.target.value }))} />
              </div>
              <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => addSensor.mutate({ jobId: Number(sensorForm.jobId), sensorId: sensorForm.sensorId, brand: sensorForm.brand, location: sensorForm.location, material: sensorForm.material, targetWme: Number(sensorForm.targetWme) })} disabled={!sensorForm.jobId || !sensorForm.sensorId || !sensorForm.location} data-testid="button-save-sensor">Add Sensor</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Alert strip */}
      {alertSensors.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="font-semibold text-red-700 dark:text-red-400">⚠️ {alertSensors.length} sensor{alertSensors.length > 1 ? "s" : ""} above target WME</span>
          </div>
          <div className="space-y-1">
            {alertSensors.map(s => {
              const lr = getLatestReading(s.id);
              return <p key={s.id} className="text-sm text-red-700 dark:text-red-400">• {s.location} (Job #{s.job_id}) — {lr?.wme}% WME vs {s.target_wme}% target</p>;
            })}
          </div>
        </div>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : sensors.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No sensors configured</p>
            <p className="text-sm text-muted-foreground mt-1">Add sensors to monitor drying progress in real-time per IICRC S500 targets</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sensors.map((sensor: any) => {
            const latest = getLatestReading(sensor.id);
            const history = getSensorReadingHistory(sensor.id);
            const isAlert = latest?.is_alert;
            const isDry = latest && latest.wme <= sensor.target_wme;
            const pctToTarget = latest ? Math.min(100, Math.max(0, ((latest.wme - sensor.target_wme) / (history[0]?.wme || latest.wme || 1)) * 100)) : null;

            return (
              <Card key={sensor.id} className={`border-l-4 ${isAlert ? "border-l-red-500" : isDry ? "border-l-green-500" : "border-l-[hsl(var(--titan-blue))]"}`} data-testid={`card-sensor-${sensor.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">{sensor.location}</CardTitle>
                      <p className="text-xs text-muted-foreground">Job #{sensor.job_id} · {sensor.material} · {sensor.brand}</p>
                    </div>
                    {isAlert ? <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" /> : isDry ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0" /> : <Droplets className="w-5 h-5 text-[hsl(var(--titan-blue))] shrink-0" />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {latest ? (
                    <>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-3xl font-bold" data-testid={`text-wme-${sensor.id}`}>{latest.wme}%</p>
                          <p className="text-xs text-muted-foreground">WME (target: ≤{sensor.target_wme}%)</p>
                        </div>
                        <Badge variant={isAlert ? "destructive" : isDry ? "secondary" : "outline"} className="text-xs">
                          {isDry ? "✓ DRY" : isAlert ? `+${(latest.wme - sensor.target_wme).toFixed(1)}% over` : "Drying"}
                        </Badge>
                      </div>
                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${isAlert ? "bg-red-500" : isDry ? "bg-green-500" : "bg-[hsl(var(--titan-blue))]"}`} style={{ width: `${isDry ? 100 : Math.min(100, (1 - (latest.wme - sensor.target_wme) / Math.max(latest.wme, 1)) * 100)}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{history.length} readings</span>
                          <span>Last: {new Date(latest.reading_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                        </div>
                      </div>
                      {latest.temp_f && <div className="flex gap-4 text-xs text-muted-foreground"><span><Thermometer className="w-3 h-3 inline" /> {latest.temp_f}°F</span>{latest.rh_pct && <span><Droplets className="w-3 h-3 inline" /> {latest.rh_pct}% RH</span>}</div>}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No readings yet</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Dialog open={showAddReading === sensor.id} onOpenChange={v => setShowAddReading(v ? sensor.id : null)}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-1" data-testid={`button-add-reading-${sensor.id}`}><Plus className="w-3 h-3 mr-1" />Reading</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Log Reading — {sensor.location}</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div><p className="text-xs text-muted-foreground mb-1">WME % (required)</p><Input type="number" step="0.1" placeholder="e.g. 22.5" value={readingForm.wme} onChange={e => setReadingForm(f => ({ ...f, wme: e.target.value }))} /></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><p className="text-xs text-muted-foreground mb-1">Temp °F</p><Input type="number" value={readingForm.tempF} onChange={e => setReadingForm(f => ({ ...f, tempF: e.target.value }))} /></div>
                            <div><p className="text-xs text-muted-foreground mb-1">RH %</p><Input type="number" value={readingForm.rhPct} onChange={e => setReadingForm(f => ({ ...f, rhPct: e.target.value }))} /></div>
                          </div>
                          <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => addReading.mutate({ sensorId: sensor.id, jobId: sensor.job_id, data: { wme: Number(readingForm.wme), tempF: readingForm.tempF ? Number(readingForm.tempF) : undefined, rhPct: readingForm.rhPct ? Number(readingForm.rhPct) : undefined } })} disabled={!readingForm.wme}>Save Reading</Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button variant="outline" size="sm" onClick={() => fetchPrediction(sensor.id)} data-testid={`button-predict-${sensor.id}`}><TrendingDown className="w-3 h-3 mr-1" />Predict</Button>
                    <Button variant="outline" size="sm" onClick={() => deleteSensor.mutate(sensor.id)} className="text-red-500 hover:text-red-700" data-testid={`button-delete-sensor-${sensor.id}`}>✕</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Prediction modal */}
      <Dialog open={showPrediction !== null} onOpenChange={v => { if (!v) { setShowPrediction(null); setPrediction(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dry-Out Prediction</DialogTitle></DialogHeader>
          {prediction && (
            <div className="space-y-3">
              {prediction.prediction === "already_dry" ? (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                  <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
                  <p className="font-semibold text-green-700 dark:text-green-400">Target WME achieved!</p>
                  <p className="text-sm text-muted-foreground mt-1">{prediction.message}</p>
                </div>
              ) : prediction.prediction === null ? (
                <p className="text-sm text-muted-foreground">{prediction.message}</p>
              ) : (
                <div className="space-y-3">
                  <div className="bg-[hsl(var(--titan-blue)/0.1)] rounded-lg p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Predicted Dry-Out Date</p>
                    <p className="text-xl font-bold">{prediction.predictedDryDateFormatted}</p>
                    <p className="text-sm text-muted-foreground">{prediction.hoursRemaining} hours remaining</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-muted/40 rounded p-2"><p className="text-xs text-muted-foreground">Current WME</p><p className="font-bold">{prediction.currentWme}%</p></div>
                    <div className="bg-muted/40 rounded p-2"><p className="text-xs text-muted-foreground">Target WME</p><p className="font-bold">{prediction.targetWme}%</p></div>
                    <div className="bg-muted/40 rounded p-2"><p className="text-xs text-muted-foreground">Drying Rate</p><p className="font-bold">{prediction.dryingRatePerHour}%/hr</p></div>
                  </div>
                  <p className="text-xs text-muted-foreground">Confidence: <span className="font-medium">{prediction.confidence}</span> — based on {prediction.confidence === "high" ? "5+" : "2-4"} data points</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

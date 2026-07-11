import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, User, Phone, CheckCircle, Plus, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Message { role: "bot" | "user"; text: string; time: string; }

const LOSS_TYPES = ["water", "fire", "mold", "storm", "biohazard", "reconstruction"];

const QUESTIONS = [
  { key: "name", q: "Hi! I'm the Titan Restoration 24/7 emergency intake assistant. To get you help fast, what's your full name?" },
  { key: "phone", q: "Thanks! What's the best phone number to reach you at?" },
  { key: "address", q: "What's the address of the property that needs service?" },
  { key: "loss_type", q: "What type of damage are you experiencing? (water, fire, mold, storm, biohazard, or other)" },
  { key: "description", q: "Can you describe what happened in a few sentences?" },
  { key: "insurance_carrier", q: "Do you have homeowner's insurance? If yes, what's your carrier name? (Or say 'none' or 'unsure')" },
  { key: "claim_number", q: "Do you have a claim number yet? If not, that's okay — just say 'no'." },
  { key: "urgency", q: "How urgent is this? 1=Emergency/Active water now, 2=Today, 3=Can wait a day or two" },
  { key: "confirm", q: null },
];

export default function FNOLChatbot() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [activeSession, setActiveSession] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: recentJobs = [] } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
    select: (d: any[]) => d.slice(0, 5),
  });

  const createJobMutation = useMutation({
    mutationFn: (jobData: any) => apiRequest("/api/jobs", { method: "POST", body: JSON.stringify(jobData) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }); },
  });

  const createContactMutation = useMutation({
    mutationFn: (cData: any) => apiRequest("/api/contacts", { method: "POST", body: JSON.stringify(cData) }).then(r => r.json()),
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const addMessage = (role: "bot" | "user", text: string) => {
    setMessages(prev => [...prev, { role, text, time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) }]);
  };

  const startSession = () => {
    setActiveSession(true);
    setStep(0);
    setData({});
    setSubmitted(false);
    setMessages([]);
    setTimeout(() => addMessage("bot", QUESTIONS[0].q!), 300);
  };

  const normalizeInput = (val: string, key: string) => {
    if (key === "loss_type") {
      const lower = val.toLowerCase();
      for (const lt of LOSS_TYPES) { if (lower.includes(lt)) return lt; }
      return "other";
    }
    if (key === "urgency") return val.replace(/[^1-3]/g, "") || "2";
    if (key === "claim_number" && (val.toLowerCase() === "no" || val.toLowerCase() === "none")) return "";
    if (key === "insurance_carrier" && ["none","no","n/a","unsure"].includes(val.toLowerCase())) return "";
    return val;
  };

  const handleSend = async () => {
    if (!input.trim() || submitting) return;
    const userText = input.trim();
    setInput("");
    addMessage("user", userText);

    const currentQ = QUESTIONS[step];
    const val = normalizeInput(userText, currentQ.key);
    const newData = { ...data, [currentQ.key]: val };
    setData(newData);

    if (step < QUESTIONS.length - 2) {
      const next = QUESTIONS[step + 1];
      if (next.key === "confirm") {
        // Summary
        setTimeout(() => {
          addMessage("bot", `Here's what I have:\n\n👤 ${newData.name}\n📞 ${newData.phone}\n📍 ${newData.address}\n🔥 Loss Type: ${newData.loss_type}\n📝 ${newData.description}\n🏢 Carrier: ${newData.insurance_carrier || "None"}\n#️⃣ Claim: ${newData.claim_number || "None yet"}\n⚡ Urgency: ${newData.urgency === "1" ? "EMERGENCY" : newData.urgency === "2" ? "Today" : "Next 1-2 days"}\n\nShall I create this lead and notify the Titan team? (yes/no)`);
          setStep(step + 1);
        }, 400);
      } else {
        setTimeout(() => { addMessage("bot", next.q!); setStep(step + 1); }, 400);
      }
    } else {
      // Confirmation step
      if (userText.toLowerCase().startsWith("y")) {
        setSubmitting(true);
        addMessage("bot", "Creating your lead and notifying the Titan team now...");
        try {
          // Create contact
          const contact = await createContactMutation.mutateAsync({
            name: newData.name, phone: newData.phone, type: "customer", notes: `FNOL intake — ${newData.description}`,
          });
          // Create job
          const urgencyMap: Record<string, string> = { "1": "Emergency — Active damage", "2": "Today", "3": "Next 1-2 days" };
          await createJobMutation.mutateAsync({
            address: newData.address,
            loss_type: newData.loss_type || "other",
            status: "new",
            description: `FNOL: ${newData.description}\nUrgency: ${urgencyMap[newData.urgency] || "Today"}\nCarrier: ${newData.insurance_carrier || "None"}\nClaim: ${newData.claim_number || "None"}`,
            insurance_carrier: newData.insurance_carrier || null,
            claim_number: newData.claim_number || null,
            contact_id: contact.id,
          });
          // Post to messaging
          await apiRequest("/api/channels/1/messages", {
            method: "POST",
            body: JSON.stringify({
              author: "FNOL Bot",
              body: `🚨 NEW LEAD — ${newData.name} | ${newData.phone}\n📍 ${newData.address}\n🔥 ${newData.loss_type?.toUpperCase()} | Urgency: ${urgencyMap[newData.urgency] || "Today"}\n📝 ${newData.description}\n🏢 Carrier: ${newData.insurance_carrier || "None"} | Claim: ${newData.claim_number || "None"}`
            })
          });
          setSubmitted(true);
          setSubmitting(false);
          addMessage("bot", `✅ Done! The Titan team has been notified and a new job has been created.\n\nSomeone will contact ${newData.name} at ${newData.phone} shortly. For immediate emergencies call 706-922-0154 directly.\n\nIs there anything else you need?`);
        } catch (e) {
          setSubmitting(false);
          addMessage("bot", "I had trouble creating the lead — please call us directly at 706-922-0154.");
        }
      } else {
        addMessage("bot", "No problem! Let's start over or you can call us directly at 706-922-0154.");
        setTimeout(() => { startSession(); }, 800);
      }
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6 text-blue-500" />
          FNOL Intake Chatbot — 24/7 Lead Capture
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automated first-notice-of-loss intake. Captures lead info and creates job automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chatbot */}
        <div className="lg:col-span-2">
          <Card className="flex flex-col h-[600px]">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Titan Assistant</p>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-xs text-muted-foreground">Online 24/7</span>
                    </div>
                  </div>
                </div>
                <Badge className="bg-red-600 text-white text-xs">Emergency: 706-922-0154</Badge>
              </div>
            </CardHeader>
            <ScrollArea className="flex-1 p-4">
              {!activeSession ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <Bot className="h-16 w-16 text-blue-500" />
                  <div className="text-center">
                    <p className="font-semibold">Titan Restoration 24/7 Intake</p>
                    <p className="text-sm text-muted-foreground mt-1">Start a simulated FNOL intake session</p>
                  </div>
                  <Button onClick={startSession} className="bg-blue-600 hover:bg-blue-700" data-testid="button-start-session">
                    <Plus className="h-4 w-4 mr-2" /> Start Intake Session
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "bot" && (
                        <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center shrink-0">
                          <Bot className="h-3 w-3 text-white" />
                        </div>
                      )}
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-line ${msg.role === "bot" ? "bg-muted text-foreground" : "bg-blue-600 text-white"}`}>
                        {msg.text}
                        <p className={`text-xs mt-1 ${msg.role === "bot" ? "text-muted-foreground" : "text-blue-100"}`}>{msg.time}</p>
                      </div>
                      {msg.role === "user" && (
                        <div className="w-7 h-7 bg-slate-400 rounded-full flex items-center justify-center shrink-0">
                          <User className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              )}
            </ScrollArea>
            {activeSession && (
              <div className="p-3 border-t flex gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                  placeholder={submitted ? "Session complete" : "Type your response..."}
                  disabled={submitting || submitted}
                  data-testid="input-chat"
                />
                <Button onClick={handleSend} disabled={submitting || submitted || !input.trim()} className="bg-blue-600 hover:bg-blue-700" data-testid="button-send">
                  {submitting ? <span className="animate-spin">⟳</span> : <Send className="h-4 w-4" />}
                </Button>
                {submitted && (
                  <Button variant="outline" onClick={startSession} data-testid="button-restart">New</Button>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="bg-red-50 border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-red-800 flex items-center gap-2">
                <Phone className="h-4 w-4" /> Emergency Contact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-700">706-922-0154</p>
              <p className="text-xs text-red-600 mt-1">Available 24/7 for emergencies</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <p>Homeowner reports damage via chat on your website</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <p>Bot collects name, phone, address, loss type, carrier</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <p>Job auto-created in Titan Pro with contact linked</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <p>Team notified via internal messaging channel</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Jobs Created</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {recentJobs.map((j: any) => (
                <div key={j.id} className="text-xs border-b pb-1 last:border-0">
                  <p className="font-semibold">{j.job_number}</p>
                  <p className="text-muted-foreground truncate">{j.address}</p>
                  <Badge variant="outline" className="text-xs">{j.loss_type}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

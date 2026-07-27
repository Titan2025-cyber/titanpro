import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageSquare, Send, Phone, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Job } from "@shared/schema";

export default function SMS() {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [toNumber, setToNumber] = useState("");

  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const customers = contacts.filter(c => c.type === "customer");

  const { data: thread = [] } = useQuery<any[]>({
    queryKey: ["/api/sms/contact", selectedContactId],
    queryFn: () => selectedContactId
      ? apiRequest("GET", `/api/sms/contact/${selectedContactId}`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedContactId,
  });

  const sendMutation = useMutation({
    mutationFn: async (data: any) =>
      apiRequest("POST", "/api/sms", data).then(r => r.json()),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/sms/contact", selectedContactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Message sent", description: "SMS delivered successfully." });
    },
    onError: () => toast({ title: "Failed to send", variant: "destructive" }),
  });

  const selectedContact = contacts.find(c => c.id === selectedContactId);

  const handleSend = () => {
    if (!message.trim()) return;
    const to = selectedContact?.phone || toNumber;
    if (!to) {
      toast({ title: "No phone number", description: "Select a contact with a phone number.", variant: "destructive" });
      return;
    }
    sendMutation.mutate({
      contactId: selectedContactId,
      jobId: selectedJobId,
      direction: "outbound",
      from: "Titan Restoration (706-922-0154)",
      to,
      body: message.trim(),
    });
  };

  // Quick templates
  const templates = [
    "Hi {name}, this is Titan Restoration. Your job is scheduled for tomorrow. Please call 706-922-0154 with any questions.",
    "Hi {name}, our technician is on their way and will arrive within 30 minutes. — Titan Restoration",
    "Hi {name}, your drying equipment has been checked today and is performing well. We'll be back tomorrow. — Titan Restoration",
    "Hi {name}, great news — your job is complete! Please review and sign your invoice at your earliest convenience. — Titan Restoration",
    "Hi {name}, we'd love your feedback! Can you leave us a Google review? It only takes 2 minutes and helps families in need find us. — Titan Restoration",
  ];

  return (
    <div className="flex gap-6 h-[calc(100vh-120px)]">
      {/* Left: Contact list */}
      <div className="w-64 shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[hsl(var(--titan-blue))]" />SMS
          </h1>
        </div>
        <Card className="flex-1 overflow-hidden">
          <CardHeader className="pb-2 pt-3 px-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customers</p>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto">
            {customers.map(c => (
              <button
                key={c.id}
                onClick={() => { setSelectedContactId(c.id); setToNumber(c.phone || ""); }}
                className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors border-b border-border last:border-0 text-left ${
                  selectedContactId === c.id ? "bg-[hsl(var(--titan-blue)/0.05)] border-l-2 border-l-[hsl(var(--titan-blue))]" : ""
                }`}
                data-testid={`contact-sms-${c.id}`}
              >
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--titan-blue))] flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {c.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.phone || "No phone"}</p>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Right: Chat area */}
      <div className="flex-1 flex flex-col gap-4">
        {selectedContact ? (
          <>
            {/* Header */}
            <Card>
              <CardContent className="py-3 px-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[hsl(var(--titan-blue))] flex items-center justify-center text-white font-bold">
                    {selectedContact.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{selectedContact.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{selectedContact.phone || "No phone"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedJobId || ""}
                    onChange={e => setSelectedJobId(e.target.value ? Number(e.target.value) : null)}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
                    data-testid="select-job-link"
                  >
                    <option value="">Link to job (optional)</option>
                    {jobs.filter(j => j.contactId === selectedContactId || !j.contactId).map(j => (
                      <option key={j.id} value={j.id}>{j.jobNumber} — {j.address}</option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Messages */}
            <Card className="flex-1 overflow-hidden flex flex-col">
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                {thread.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    No messages yet. Start the conversation below.
                  </div>
                ) : (
                  thread.map((msg: any) => (
                    <div key={msg.id} className={`group flex items-center gap-1 ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      {msg.direction === "outbound" && <DeleteMessageBtn id={msg.id} contactId={selectedContactId} />}
                      <div className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                        msg.direction === "outbound"
                          ? "bg-[hsl(var(--titan-blue))] text-white rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      }`}>
                        <p>{msg.body}</p>
                        <p className={`text-xs mt-1 ${msg.direction === "outbound" ? "text-blue-200" : "text-muted-foreground"}`}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      {msg.direction !== "outbound" && <DeleteMessageBtn id={msg.id} contactId={selectedContactId} />}
                    </div>
                  ))
                )}
              </CardContent>

              {/* Templates + Input */}
              <div className="border-t border-border p-3 space-y-2">
                {/* Template picker */}
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {templates.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => setMessage(t.replace("{name}", selectedContact.name.split(" ")[0]))}
                      className="shrink-0 text-xs bg-muted hover:bg-muted/80 border border-border rounded-full px-3 py-1 text-muted-foreground whitespace-nowrap"
                    >
                      Template {i + 1}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 min-h-[60px] max-h-28 resize-none text-sm"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
                    data-testid="input-sms-message"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!message.trim() || sendMutation.isPending}
                    className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white self-end"
                    data-testid="button-send-sms"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </>
        ) : (
          <Card className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-2">Two-Way SMS</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Select a customer from the list to start a conversation. Messages are logged to the job file automatically.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function DeleteMessageBtn({ id, contactId }: { id: number; contactId: number | null }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/sms/${id}`),
    onSuccess: () => {
      toast({ title: "Message deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sms/contact", contactId] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
          data-testid={`button-delete-sms-${id}`}
          aria-label="Delete message"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this message?</AlertDialogTitle>
          <AlertDialogDescription>This permanently removes the message from the record and cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-sms-${id}`}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

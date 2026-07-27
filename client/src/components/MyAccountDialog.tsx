import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { UserCog, Key } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

// apiRequest throws Error(`<status>: <body>`) where <body> is usually JSON.
async function errMsg(err: any): Promise<string> {
  const raw = typeof err?.message === "string" ? err.message : "";
  const m = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = (m ? m[1] : raw).trim();
  if (body.startsWith("{")) {
    try { const j = JSON.parse(body); return j.error || j.message || body; } catch { /* fall through */ }
  }
  return body || "Something went wrong. Please try again.";
}

/**
 * Self-service account controls for the logged-in user. Any staff member can
 * change their own login email, password, and PIN here — no owner needed.
 * Uses POST /api/auth/change-password (extended to also accept newEmail).
 */
export default function MyAccountDialog({ open, onOpenChange }: {
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPin, setNewPin] = useState("");

  useEffect(() => {
    if (open) {
      setEmail(user?.gmailEmail || "");
      setCurrentPassword("");
      setNewPassword("");
      setNewPin("");
    }
  }, [open, user?.gmailEmail]);

  const save = useMutation({
    mutationFn: () => {
      const payload: any = {};
      if (currentPassword) payload.currentPassword = currentPassword;
      if (newPassword) payload.newPassword = newPassword;
      if (newPin) payload.newPin = newPin;
      if (email && email.trim() && email.trim() !== (user?.gmailEmail || "")) payload.newEmail = email.trim();
      return apiRequest("POST", "/api/auth/change-password", payload);
    },
    onSuccess: async () => {
      await refreshUser();
      toast({ title: "Account updated" });
      onOpenChange(false);
    },
    onError: async (err) => toast({ title: "Couldn't update account", description: await errMsg(err), variant: "destructive" }),
  });

  const emailChanged = email.trim() !== (user?.gmailEmail || "");
  const wantsPasswordChange = !!newPassword;
  const nothingToSave = !emailChanged && !newPassword && !newPin;
  // Server requires the current password to verify a password change.
  const needsCurrent = wantsPasswordChange && !currentPassword;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-4 h-4 text-[hsl(var(--titan-blue))]" />My Account
          </DialogTitle>
          <DialogDescription>
            Update your own login email, password, and PIN. Changes take effect immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Login Email</Label>
            <Input
              className="h-9 text-sm mt-1"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              data-testid="input-myaccount-email"
            />
            <p className="text-[11px] text-muted-foreground mt-1">This is what you type to sign in.</p>
          </div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-semibold flex items-center gap-1.5"><Key className="w-3.5 h-3.5" />Change password / PIN</p>
            <div>
              <Label className="text-xs">Current Password <span className="text-muted-foreground">(required to set a new password)</span></Label>
              <Input className="h-9 text-sm mt-1" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Current password" data-testid="input-myaccount-current" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">New Password</Label>
                <Input className="h-9 text-sm mt-1" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Leave blank to keep" data-testid="input-myaccount-newpw" />
              </div>
              <div>
                <Label className="text-xs">New PIN <span className="text-muted-foreground">(4–8 digits)</span></Label>
                <Input className="h-9 text-sm mt-1" type="password" maxLength={8} value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="Leave blank to keep" data-testid="input-myaccount-newpin" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button
            className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => save.mutate()}
            disabled={save.isPending || nothingToSave || needsCurrent}
            data-testid="button-myaccount-save"
          >
            {save.isPending ? "Saving…" : needsCurrent ? "Enter current password" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

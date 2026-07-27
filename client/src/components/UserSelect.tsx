import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Shared user-picker ─────────────────────────────────────────────────────────
// A single, app-wide dropdown for choosing a user (staff member). It sources its
// options from GET /api/staff/assignable, which returns ONLY users marked Active
// in the User Management module. Deactivating a user in User Management removes
// them from every one of these dropdowns automatically.
//
// Role filtering: pass `roles` to limit options to those roles (owner/admin are
// always included since they can act in any capacity). Omit `roles` to show all
// active users.
//
// Value model: by default the selected value is the user's NAME (matching the
// existing free-text fields like job.assignedTech). Set `valueBy="id"` to store
// the numeric user id as a string instead.

export interface AssignableUser {
  id: number;
  name: string;
  role: string;
  position: string | null;
  avatarInitials: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  tech: "Tech",
  sales: "Sales",
  office: "Office",
};

// Sentinel used internally so we can offer an "Unassigned" option (Radix Select
// disallows empty-string item values).
const NONE = "__none__";

export function UserSelect({
  value,
  onChange,
  roles,
  valueBy = "name",
  placeholder = "Select a user",
  allowUnassigned = false,
  unassignedLabel = "Unassigned",
  disabled = false,
  className,
  testId = "select-user",
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  roles?: string[];
  valueBy?: "name" | "id";
  placeholder?: string;
  allowUnassigned?: boolean;
  unassignedLabel?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const roleParam = roles && roles.length ? roles.join(",") : "";
  const { data: users = [], isLoading } = useQuery<AssignableUser[]>({
    queryKey: ["/api/staff/assignable", roleParam],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/staff/assignable${roleParam ? `?role=${encodeURIComponent(roleParam)}` : ""}`,
      ).then((r) => r.json()),
  });

  const currentValue =
    value === null || value === undefined || value === "" ? NONE : String(value);

  return (
    <Select
      value={currentValue}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue
          placeholder={isLoading ? "Loading users…" : users.length ? placeholder : "No active users"}
        />
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned && (
          <SelectItem value={NONE} data-testid={`${testId}-none`}>
            {unassignedLabel}
          </SelectItem>
        )}
        {users.map((u) => {
          const optValue = valueBy === "id" ? String(u.id) : u.name;
          return (
            <SelectItem key={u.id} value={optValue} data-testid={`${testId}-${u.id}`}>
              {u.name}
              {ROLE_LABEL[u.role] ? ` · ${ROLE_LABEL[u.role]}` : ""}
            </SelectItem>
          );
        })}
        {!isLoading && users.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No active users. Add users in User Management.
          </div>
        )}
      </SelectContent>
    </Select>
  );
}

export default UserSelect;

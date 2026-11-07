export type InvitationAuditInput = { username: string; displayName: string; email: string; phone: string };

/** Explicit allowlist: never spread submitted credentials into an audit record. */
export function invitationAuditRecord(input: InvitationAuditInput, adminId: string, adminName: string) {
  return {
    admin_id: adminId,
    admin_name: adminName,
    username: input.username,
    display_name: input.displayName,
    email: input.email || null,
    phone: input.phone,
    status: "started" as const,
    email_status: input.email ? "not_sent" as const : "not_requested" as const,
  };
}
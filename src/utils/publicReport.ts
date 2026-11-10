/** Internal moderation notes must never be included in citizen responses. */
export function toPublicReport<T extends { adminNotes?: unknown; escalationEmail?: unknown }>(report: T): Omit<T, "adminNotes" | "escalationEmail"> {
  const { adminNotes: _internalNotes, escalationEmail: _internalEmailStatus, ...publicReport } = report;
  return publicReport;
}

export function parsePublicAdminResponse(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Tanggapan admin harus berupa teks maksimal 2.000 karakter.");
  return value.trim() || null;
}

// Separate staff portals: admin roles never act as agency officers.
export const ADMIN_PORTAL_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const AGENCY_PORTAL_ROLES = ["PETUGAS_INSTANSI"] as const;

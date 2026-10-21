export const ROLES = ["ADMIN", "DIRECTOR", "BOOKKEEPER", "TEACHER", "PARENT", "KIOSK"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  DIRECTOR: "Director",
  BOOKKEEPER: "Bookkeeper",
  TEACHER: "Teacher",
  PARENT: "Parent",
  KIOSK: "Check-in kiosk",
};

export const STAFF: Role[] = ["ADMIN", "DIRECTOR"];
export const FINANCE: Role[] = ["ADMIN", "DIRECTOR", "BOOKKEEPER"];
export const CLASSROOM: Role[] = ["ADMIN", "DIRECTOR", "TEACHER"];
export const APPROVERS: Role[] = ["ADMIN", "DIRECTOR"];
export const KIOSK_OPERATORS: Role[] = ["KIOSK", "ADMIN", "DIRECTOR"];

// Longest prefix wins, so list specific routes before their parents.
export const ROUTE_RULES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/portal", roles: ["PARENT"] },
  { prefix: "/kiosk", roles: KIOSK_OPERATORS },
  { prefix: "/dashboard", roles: FINANCE },
  { prefix: "/leads", roles: STAFF },
  { prefix: "/families", roles: FINANCE },
  { prefix: "/classrooms", roles: CLASSROOM },
  { prefix: "/attendance", roles: CLASSROOM },
  { prefix: "/billing", roles: FINANCE },
  { prefix: "/accounting", roles: FINANCE },
  { prefix: "/integrations", roles: FINANCE },
];

export function homeForRole(role: Role): string {
  switch (role) {
    case "PARENT":
      return "/portal";
    case "KIOSK":
      return "/kiosk";
    case "TEACHER":
      return "/attendance";
    default:
      return "/dashboard";
  }
}

export function canAccess(role: Role, pathname: string): boolean {
  const rule = ROUTE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return !rule || rule.roles.includes(role);
}

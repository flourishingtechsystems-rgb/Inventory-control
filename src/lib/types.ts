export const ROLES = ["REQUESTER", "MANAGER", "FINANCE", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  MANAGER: "Manager",
  FINANCE: "Finance",
  ADMIN: "Admin",
};

export function homeForRole(role: Role): string {
  switch (role) {
    case "MANAGER":
      return "/approvals";
    case "FINANCE":
      return "/finance";
    case "ADMIN":
      return "/admin/items";
    case "REQUESTER":
    default:
      return "/requests";
  }
}

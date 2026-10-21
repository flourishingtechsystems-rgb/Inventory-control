import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { homeForRole } from "@/lib/roles";

export default async function Home() {
  const session = await auth();
  redirect(session?.user ? homeForRole(session.user.role) : "/login");
}

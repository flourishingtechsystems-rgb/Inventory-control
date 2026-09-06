import { LoginForm } from "./LoginForm";

const DEMO_ACCOUNTS = [
  { role: "Requester", email: "requester@demo.com" },
  { role: "Manager", email: "manager@demo.com" },
  { role: "Finance", email: "finance@demo.com" },
  { role: "Admin", email: "admin@demo.com" },
];

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">
          Inventory Control
        </h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500">
          Sign in to request, approve, or track supply orders.
        </p>
        <LoginForm />
        <div className="mt-6 border-t border-zinc-100 pt-4 text-xs text-zinc-500">
          <p className="mb-1 font-medium text-zinc-600">Demo accounts</p>
          <p className="mb-2">Password for all: password123</p>
          <ul className="space-y-0.5">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email} className="flex justify-between gap-2">
                <span>{a.role}</span>
                <span className="font-mono">{a.email}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

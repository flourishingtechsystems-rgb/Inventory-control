import { LoginForm } from "./LoginForm";

const DEMO = [
  ["Director", "director@demo.com"],
  ["Bookkeeper", "books@demo.com"],
  ["Teacher", "teacher@demo.com"],
  ["Parent", "parent@demo.com"],
];

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-gradient-to-br from-teal-900 to-teal-700 px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-300 font-bold text-teal-900">N</span>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Nestwise</h1>
            <p className="text-xs text-zinc-500">Childcare CRM with real accounting</p>
          </div>
        </div>
        <LoginForm />
        <div className="mt-6 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
          <div className="mb-1 font-medium">Demo accounts (password: password123)</div>
          {DEMO.map(([role, email]) => (
            <div key={email} className="flex justify-between">
              <span>{role}</span>
              <span className="font-mono">{email}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

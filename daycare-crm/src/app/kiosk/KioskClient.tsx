"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kioskEnterPin, kioskToggle, type KioskState } from "./actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
const IDLE_RESET_MS = 45_000;

export function KioskClient({ centerName, code, codeExpires, exitHref }: { centerName: string; code: string; codeExpires: string; exitHref?: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [state, setState] = useState<KioskState>({ stage: "pin" });
  const [pending, start] = useTransition();
  const [clock, setClock] = useState("");

  // Keep the clock and the rotating phone code fresh.
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 10_000);
    const refresh = setTimeout(() => router.refresh(), Math.max(1_000, new Date(codeExpires).getTime() - Date.now() + 1_000));
    return () => {
      clearInterval(id);
      clearTimeout(refresh);
    };
  }, [codeExpires, router]);

  // Never leave a family's screen open on a shared tablet.
  useEffect(() => {
    if (state.stage !== "family") return;
    const id = setTimeout(() => {
      setState({ stage: "pin" });
      setPin("");
    }, IDLE_RESET_MS);
    return () => clearTimeout(id);
  }, [state]);

  const press = (key: string) => {
    if (pending) return;
    if (key === "clear") return setPin("");
    if (key === "back") return setPin((p) => p.slice(0, -1));
    const next = (pin + key).slice(0, 6);
    setPin(next);
    if (next.length === 6) {
      start(async () => {
        const result = await kioskEnterPin(next);
        setState(result);
        setPin("");
      });
    }
  };

  const done = () => {
    setState({ stage: "pin" });
    setPin("");
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-teal-900 to-teal-700 text-white">
      <header className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-300 text-lg font-bold text-teal-900">N</span>
          <span className="text-xl font-semibold">{centerName}</span>
        </div>
        <span className="flex items-center gap-4">
          {exitHref && <a href={exitHref} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Exit kiosk preview</a>}
          <span className="text-2xl font-light tabular-nums">{clock}</span>
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        {state.stage === "pin" ? (
          <div className="w-full max-w-sm text-center">
            <h1 className="text-3xl font-semibold">Welcome!</h1>
            <p className="mt-2 text-teal-100">Enter your 6-digit check-in PIN</p>
            <div className="my-6 flex justify-center gap-3" aria-label="PIN entered" data-testid="pin-dots">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-amber-300" : "bg-white/25"}`} />
              ))}
            </div>
            {state.error && <p role="alert" className="mb-4 rounded-lg bg-red-500/20 px-3 py-2 text-sm">{state.error}</p>}
            <div className="grid grid-cols-3 gap-3">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  disabled={pending}
                  aria-label={k === "back" ? "Backspace" : k === "clear" ? "Clear" : k}
                  className="h-16 rounded-2xl bg-white/10 text-2xl font-medium hover:bg-white/20 active:bg-white/30 disabled:opacity-50"
                >
                  {k === "back" ? "⌫" : k === "clear" ? "C" : k}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-xl text-center">
            <h1 className="text-3xl font-semibold">Hi {state.guardianName}!</h1>
            <p className="mt-2 text-teal-100">Tap a child to check them in or out.</p>
            {state.message && <p role="status" className="mt-4 rounded-lg bg-emerald-400/20 px-3 py-2">{state.message}</p>}
            {state.error && <p role="alert" className="mt-4 rounded-lg bg-red-500/20 px-3 py-2">{state.error}</p>}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {state.children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={pending || (c.checkedIn && !state.canPickup)}
                  onClick={() => start(async () => setState(await kioskToggle(state.token, c.id)))}
                  className={`rounded-2xl p-5 text-left text-teal-950 shadow-lg disabled:opacity-60 ${c.checkedIn ? "bg-amber-200" : "bg-white"}`}
                >
                  <div className="text-xl font-semibold">{c.firstName}</div>
                  <div className="text-sm text-teal-800">{c.classroomName}</div>
                  <div className="mt-3 text-sm font-semibold uppercase tracking-wide">
                    {c.checkedIn ? (state.canPickup ? "Check out →" : "Checked in · see front desk to pick up") : "Check in →"}
                  </div>
                </button>
              ))}
            </div>
            {state.children.length === 0 && <p className="mt-6 text-teal-100">No enrolled children found — please see the front desk.</p>}
            <button type="button" onClick={done} className="mt-8 rounded-xl bg-white/15 px-6 py-3 text-lg hover:bg-white/25">
              Done
            </button>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between px-8 py-5 text-sm text-teal-100">
        <span>Checking in from your phone? Use this code in the parent app:</span>
        <span className="rounded-lg bg-white/10 px-4 py-2 font-mono text-2xl tracking-[0.3em] text-white" data-testid="center-code">
          {code}
        </span>
      </footer>
    </div>
  );
}

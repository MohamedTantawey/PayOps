"use client";
import { useRef, useState } from "react";
export function RefundForm({ orderId }: { orderId: string }) {
  const key = useRef<string>(); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  return <form onSubmit={async e => { e.preventDefault(); setBusy(true); key.current ??= crypto.randomUUID(); const form = new FormData(e.currentTarget); try { const result = await fetch("/api/refunds", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ orderId, why: form.get("why") }) }); const data = await result.json(); if (result.ok) window.location.reload(); else setStatus(data.error); } catch { setStatus("Network error. Retry uses the same key."); } finally { setBusy(false); } }}><input name="why" required minLength={3} maxLength={500} placeholder="Refund reason" className="w-36 rounded bg-zinc-800 p-2 text-xs" /><button disabled={busy} className="m-2 rounded border border-amber-500 px-3 py-2 text-xs">{busy ? "Working..." : "Full refund"}</button><p className="text-xs text-rose-300">{status}</p></form>;
}

"use client";

import { useState, useCallback } from "react";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1500;

export function InvoiceDownloadButton({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const download = useCallback(async () => {
    setStatus("preparing");
    setErrorMessage(null);

    let lastResponse: Response | null = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const res = await fetch(`/api/invoice?orderId=${encodeURIComponent(orderId)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        lastResponse = res;

        if (res.status === 202) {
          // Worker hasn't produced the PDF yet; wait and retry.
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }

        if (res.status === 200) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `invoice-${orderId.replace(/[^\w-]/g, "_")}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setStatus("ready");
          return;
        }

        if (res.status === 404) {
          setStatus("error");
          setErrorMessage("Invoice not found for this order.");
          return;
        }

        if (res.status === 409) {
          setStatus("error");
          setErrorMessage("Invoice is not ready yet.");
          return;
        }

        setStatus("error");
        setErrorMessage(`Invoice service returned ${res.status}.`);
        return;
      } catch (err) {
        if (i === MAX_RETRIES - 1) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Failed to download invoice.");
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    if (!lastResponse) {
      setStatus("error");
      setErrorMessage("Failed to reach invoice service.");
      return;
    }

    // If we exhausted retries on 202, tell the user it's still being prepared.
    if (lastResponse.status === 202) {
      setStatus("error");
      setErrorMessage("Invoice is still being prepared. Please try again shortly.");
    }
  }, [orderId]);

  if (status === "ready") {
    return (
      <button className="payops-button payops-button--secondary" onClick={download} disabled>
        Downloaded
      </button>
    );
  }

  if (status === "error") {
    return (
      <div className="payops-checkout-actions">
        <button className="payops-button payops-button--secondary" onClick={download}>
          Download Invoice
        </button>
        <span className="payops-error-message">{errorMessage}</span>
      </div>
    );
  }

  return (
    <button
      className="payops-button payops-button--secondary"
      onClick={download}
      disabled={status === "preparing"}
    >
      {status === "preparing" ? "Preparing invoice…" : "Download Invoice"}
    </button>
  );
}
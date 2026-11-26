"use client";

import { useState, useRef } from "react";

export function BuyButton({
  productId,
  disabled,
}: {
  productId: string;
  disabled?: boolean;
}) {
  const key = useRef<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    key.current ??= crypto.randomUUID();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({ productId, quantity: 1 }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "Checkout failed");
      }
    } catch {
      setError("Network error, try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="payops-buy">
      <button
        onClick={buy}
        disabled={disabled || loading}
        className="payops-buy-button"
      >
        {loading ? "Opening checkout…" : disabled ? "Sold out" : <>Buy now <span aria-hidden="true">↗</span></>}
      </button>
      {error && <p role="alert" className="payops-buy-error">{error}</p>}
    </div>
  );
}

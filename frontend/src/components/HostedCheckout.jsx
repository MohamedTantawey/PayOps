import React, { useEffect, useState } from 'react';
import './HostedCheckout.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function checkoutRequest(path, secret, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'X-Checkout-Secret': secret,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: 'Unexpected response from the payment service.' } };
  }
  if (!response.ok) throw new Error(data?.error?.message || `Payment service returned HTTP ${response.status}.`);
  return data;
}

export function HostedCheckout({ intentId }) {
  const [checkout, setCheckout] = useState(null);
  const [card, setCard] = useState({ number: '', cvv: '', exp_month: '', exp_year: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const secret = window.location.hash.slice(1);

  useEffect(() => {
    let active = true;
    if (!secret) {
      setError('This payment link is incomplete. Return to the store and start checkout again.');
      setLoading(false);
      return () => { active = false; };
    }

    checkoutRequest(`/api/payments/checkout/${encodeURIComponent(intentId)}`, secret)
      .then(({ checkout: session }) => {
        if (!active) return;
        setCheckout(session);
        if (session.status === 'succeeded') window.location.assign(session.return_url);
        if (session.status === 'canceled') window.location.assign(session.cancel_url);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [intentId, secret]);

  const updateCard = (field) => (event) => {
    setCard((current) => ({ ...current, [field]: event.target.value }));
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await checkoutRequest(
        `/api/payments/checkout/${encodeURIComponent(intentId)}/confirm`,
        secret,
        { method: 'POST', body: JSON.stringify({ card }) }
      );
      if (result.intent?.status === 'succeeded' && result.redirect_url) {
        window.location.assign(result.redirect_url);
        return;
      }
      if (result.intent?.status === 'failed') {
        setError('The test payment was declined. Check the card details or use the successful test card and try again.');
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelCheckout = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await checkoutRequest(
        `/api/payments/checkout/${encodeURIComponent(intentId)}/cancel`,
        secret,
        { method: 'POST', body: JSON.stringify({}) }
      );
      if (result.redirect_url) window.location.assign(result.redirect_url);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <CheckoutShell>
        <section className="checkout-state" aria-live="polite">
          <span className="checkout-spinner" aria-hidden="true" />
          <h1>Preparing secure checkout</h1>
          <p>Connecting to PayOps…</p>
        </section>
      </CheckoutShell>
    );
  }
  if (!checkout) {
    return (
      <CheckoutShell>
        <section className="checkout-state">
          <span className="checkout-state-icon checkout-state-icon--error" aria-hidden="true">!</span>
          <p className="checkout-eyebrow">PAYOPS / HOSTED CHECKOUT</p>
          <h1>Checkout unavailable</h1>
          <p className="checkout-state-message" role="alert">{error}</p>
        </section>
      </CheckoutShell>
    );
  }

  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: checkout.currency,
  }).format(Number(checkout.amount_cents) / 100);

  return (
    <CheckoutShell>
      <section className="checkout-card" aria-labelledby="checkout-title">
        <div className="checkout-card-heading">
          <div>
            <p className="checkout-eyebrow">PAYMENT REQUEST</p>
            <h1 id="checkout-title">Complete your payment</h1>
            <p className="checkout-subtitle">Review your order and enter your payment details.</p>
          </div>
          <span className="checkout-mode">TEST MODE</span>
        </div>

        <div className="checkout-layout">
          <aside className="checkout-summary" aria-label="Order summary">
            <p className="checkout-summary-label">Order summary</p>
            <p className="checkout-summary-description">{checkout.description || 'Store order'}</p>
            {checkout.customer_email && <p className="checkout-customer">{checkout.customer_email}</p>}
            <div className="checkout-summary-divider" />
            <div className="checkout-total">
              <span>Total due</span>
              <strong>{amount}</strong>
            </div>
          </aside>

          <form onSubmit={submitPayment} className="checkout-form">
            <div className="checkout-form-heading">
              <h2>Payment details</h2>
              <span className="checkout-secure"><span aria-hidden="true" />Secure checkout</span>
            </div>

            <label className="checkout-field">
              <span>Card number</span>
              <input
                required
                inputMode="numeric"
                autoComplete="cc-number"
                value={card.number}
                onChange={updateCard('number')}
                placeholder="4242 4242 4242 4242"
                className="checkout-input"
              />
            </label>

            <div className="checkout-field-grid">
              <label className="checkout-field">
                <span>Month</span>
                <input required inputMode="numeric" autoComplete="cc-exp-month" value={card.exp_month} onChange={updateCard('exp_month')} placeholder="12" className="checkout-input" />
              </label>
              <label className="checkout-field">
                <span>Year</span>
                <input required inputMode="numeric" autoComplete="cc-exp-year" value={card.exp_year} onChange={updateCard('exp_year')} placeholder="2029" className="checkout-input" />
              </label>
              <label className="checkout-field">
                <span>CVC</span>
                <input required inputMode="numeric" autoComplete="cc-csc" value={card.cvv} onChange={updateCard('cvv')} placeholder="123" className="checkout-input" />
              </label>
            </div>

            <p className="checkout-demo-hint">
              <strong>Test card:</strong> 4242 4242 4242 4242, any future expiry, and any 3- or 4-digit CVC. No real payment is processed.
            </p>
            {error && <p role="alert" className="checkout-error">{error}</p>}
            <button type="submit" disabled={busy} className="checkout-pay-button">
              {busy ? 'Processing…' : `Pay ${amount}`}
            </button>
            <button type="button" disabled={busy} onClick={cancelCheckout} className="checkout-cancel-button">
              Cancel and return to the store
            </button>
          </form>
        </div>
      </section>
    </CheckoutShell>
  );
}

function CheckoutShell({ children }) {
  return (
    <div className="checkout-page">
      <header className="checkout-header">
        <div className="checkout-brand">
          <span className="checkout-brand-mark" aria-hidden="true">P</span>
          <span className="checkout-brand-name">PayOps</span>
        </div>
        <span className="checkout-header-label">Hosted checkout</span>
      </header>
      <main className="checkout-main">{children}</main>
      <footer className="checkout-footer">PayOps payment platform <span aria-hidden="true">·</span> Test payments only</footer>
    </div>
  );
}

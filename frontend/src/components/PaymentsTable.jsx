import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const PRESET_CARDS = [
  { label: 'Healthy Visa (4242) — Succeeds', last4: '4242', number: '4242424242424242' },
  { label: 'Stripe 503 Trigger (9999) — Auto-Failover to Paymob', last4: '9999', number: '4242424242429999' },
  { label: 'Insufficient Funds (0002) — Hard Decline (No Retry)', last4: '0002', number: '4000000000000002' },
];

export function PaymentsTable({ mode, apiKey }) {
  const [payments, setPayments] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [amountCents, setAmountCents] = useState(14900);
  const [currency, setCurrency] = useState('USD');
  const [captureMethod, setCaptureMethod] = useState('automatic');
  const [cardPresetIdx, setCardPresetIdx] = useState(0);
  const [customerEmail, setCustomerEmail] = useState('ops-demo@payops.dev');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [payRes, anaRes] = await Promise.all([
        api.get('/api/payments?limit=25', mode, apiKey),
        api.get('/api/admin/analytics', mode, apiKey).catch(() => null),
      ]);
      setPayments(payRes.items || []);
      setAnalytics(anaRes);
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    }
  }, [mode, apiKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSimulatePayment = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const preset = PRESET_CARDS[cardPresetIdx];
      const headers = {};
      if (idempotencyKey.trim()) {
        headers['Idempotency-Key'] = idempotencyKey.trim();
      }

      const res = await api.post(
        '/api/payments',
        {
          amount_cents: Number(amountCents),
          currency,
          capture_method: captureMethod,
          customer_email: customerEmail,
          description: `Control Center Payment (${preset.last4})`,
          card: {
            number: preset.number,
            cvv: '424',
            exp_month: '12',
            exp_year: '2029',
          },
          confirm: true,
        },
        mode,
        apiKey,
        headers
      );

      const failoverNote = res.routing_summary?.failover_triggered
        ? `⚡ Failover recovered via ${res.active_attempt?.connector}!`
        : `Processed via ${res.active_attempt?.connector || 'N/A'}`;

      setBanner({
        type: res.intent?.status === 'failed' ? 'error' : 'success',
        text: `Intent ${res.intent?.id.slice(0, 8)} → ${res.intent?.status.toUpperCase()} (${failoverNote})`,
      });
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const inspectIntent = async (id) => {
    try {
      const detail = await api.get(`/api/payments/${id}`, mode, apiKey);
      setSelectedDetail(detail);
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    }
  };

  const runAction = async (id, action) => {
    setBusy(true);
    try {
      await api.post(`/api/payments/${id}/${action}`, {}, mode, apiKey);
      await refresh();
      await inspectIntent(id);
      setBanner({ type: 'success', text: `Payment ${action} succeeded.` });
    } catch (err) {
      setBanner({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      {analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={cardStyle}>
            <div style={mutedLabel}>Failover Saved Intents</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--payops-accent-ink)' }}>
              {analytics.failover_recovered_intents}
            </div>
          </div>
          {(analytics.connectors || []).map((c) => (
            <div key={c.connector} style={cardStyle}>
              <div style={mutedLabel}>{c.connector}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                ${(Number(c.volume_cents || 0) / 100).toFixed(2)} vol
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--payops-muted)' }}>
                {c.successful_attempts}/{c.total_attempts} ok · avg {c.avg_latency_ms}ms · fees ${(Number(c.total_fees_cents || 0) / 100).toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSimulatePayment} style={{ ...cardStyle, display: 'grid', gap: '1rem' }}>
        <h3 style={{ margin: 0 }}>Simulate Payment & Smart Failover</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={mutedLabel}>Amount (cents)</label>
            <input type="number" value={amountCents} onChange={(e) => setAmountCents(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={mutedLabel}>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="EGP">EGP</option>
            </select>
          </div>
          <div>
            <label style={mutedLabel}>Capture Method</label>
            <select value={captureMethod} onChange={(e) => setCaptureMethod(e.target.value)} style={inputStyle}>
              <option value="automatic">Automatic</option>
              <option value="manual">Manual (Auth Only)</option>
            </select>
          </div>
          <div>
            <label style={mutedLabel}>Idempotency-Key (optional)</label>
            <input
              type="text"
              placeholder="e.g. idem_order_101"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
          <div>
            <label style={mutedLabel}>Test Card Scenario (Tokenized via PCI Vault)</label>
            <select value={cardPresetIdx} onChange={(e) => setCardPresetIdx(Number(e.target.value))} style={inputStyle}>
              {PRESET_CARDS.map((c, idx) => (
                <option key={c.last4} value={idx}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={mutedLabel}>Customer Email</label>
            <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} style={inputStyle} />
          </div>
          <button type="submit" disabled={busy} style={primaryBtn}>
            {busy ? 'Routing...' : 'Charge Card'}
          </button>
        </div>

        {banner && (
          <div
            style={{
              padding: '0.65rem 0.9rem',
              borderRadius: 6,
              background: banner.type === 'error' ? '#7f1d1d' : '#064e3b',
              color: '#fff',
              fontSize: '0.88rem',
            }}
          >
            {banner.text}
          </div>
        )}
      </form>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Recent Payment Intents ({payments.length})</h3>
          <button onClick={refresh} style={secondaryBtn}>Refresh</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--payops-border)', textAlign: 'left', color: 'var(--payops-muted)' }}>
                <th style={thTd}>Intent ID</th>
                <th style={thTd}>Amount</th>
                <th style={thTd}>Status</th>
                <th style={thTd}>Connector</th>
                <th style={thTd}>Attempts</th>
                <th style={thTd}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--payops-border)' }}>
                  <td style={thTd}><code>{p.id.slice(0, 12)}...</code></td>
                  <td style={thTd}>{p.currency} {(Number(p.amount_cents) / 100).toFixed(2)}</td>
                  <td style={thTd}>
                    <span style={statusBadge(p.status)}>{p.status}</span>
                  </td>
                  <td style={thTd}><code>{p.active_connector || '-'}</code></td>
                  <td style={thTd}>{p.attempt_count}</td>
                  <td style={{ ...thTd, display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => inspectIntent(p.id)} style={secondaryBtn}>Inspect</button>
                    {p.status === 'requires_capture' && (
                      <button onClick={() => runAction(p.id, 'capture')} style={primaryBtn}>Capture</button>
                    )}
                    {p.status === 'succeeded' && (
                      <button onClick={() => runAction(p.id, 'refund')} style={secondaryBtn}>Refund</button>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '1rem', color: 'var(--payops-muted)', textAlign: 'center' }}>
                    No payments recorded in {mode.toUpperCase()} mode yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDetail && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Attempt Cascade Trail — <code>{selectedDetail.intent.id}</code></h4>
            <button onClick={() => setSelectedDetail(null)} style={secondaryBtn}>Close</button>
          </div>
          <ul style={{ marginTop: '0.75rem', paddingLeft: '1.2rem', fontSize: '0.86rem' }}>
            {(selectedDetail.attempts || []).map((a) => (
              <li key={a.id} style={{ marginBottom: '0.4rem' }}>
                <strong>#{a.attempt_index} {a.connector}</strong> → <code>{a.status}</code>
                {a.connector_transaction_id ? ` (tx: ${a.connector_transaction_id})` : ''}
                {a.error_code ? ` [error: ${a.error_code} - ${a.error_message}]` : ''}
                {a.metadata?.latency_ms !== undefined ? ` · ${a.metadata.latency_ms}ms` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  background: 'var(--payops-surface)',
  border: '1px solid var(--payops-border)',
  borderRadius: 8,
  padding: '1.1rem',
};

const mutedLabel = { display: 'block', fontSize: '0.78rem', color: 'var(--payops-muted)', marginBottom: '0.3rem' };

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.5rem 0.65rem',
  borderRadius: 6,
  border: '1px solid var(--payops-border)',
  background: 'var(--payops-surface-soft)',
  color: 'var(--payops-text)',
};

const primaryBtn = {
  padding: '0.5rem 0.95rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--payops-accent)',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn = {
  padding: '0.4rem 0.75rem',
  borderRadius: 6,
  border: '1px solid var(--payops-border)',
  background: 'var(--payops-surface-soft)',
  color: 'var(--payops-text)',
  cursor: 'pointer',
};

const thTd = { padding: '0.55rem 0.5rem' };

function statusBadge(status) {
  const colors =
    status === 'succeeded'
      ? { background: '#dcfce7', color: '#166534' }
      : status === 'requires_capture'
      ? { background: '#fff7ed', color: '#c56a12' }
      : status === 'failed'
      ? { background: '#fee2e2', color: '#b91c1c' }
      : { background: '#e4e4e7', color: '#52525b' };
  return {
    padding: '0.2rem 0.5rem',
    borderRadius: 4,
    fontSize: '0.76rem',
    ...colors,
  };
}

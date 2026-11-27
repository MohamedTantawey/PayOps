import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

export function WebhookLog({ mode, apiKey }) {
  const [endpoints, setEndpoints] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [targetUrl, setTargetUrl] = useState(
    import.meta.env.VITE_MOCK_PSP_WEBHOOK_URL || 'http://localhost:4001/webhook'
  );
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [epRes, delRes] = await Promise.all([
        api.get('/api/webhooks/endpoints', mode, apiKey),
        api.get('/api/webhooks/deliveries?limit=30', mode, apiKey),
      ]);
      setEndpoints(epRes.items || []);
      setDeliveries(delRes.items || []);
    } catch (err) {
      setNotice(err.message);
    }
  }, [mode, apiKey]);

  useEffect(() => {
    load();
  }, [load]);

  const addEndpoint = async (e) => {
    e.preventDefault();
    try {
      const result = await api.post('/api/webhooks/endpoints', { target_url: targetUrl }, mode, apiKey);
      setNotice(
        result.endpoint?.signing_secret
          ? `Endpoint registered. Copy this signing secret to the storefront GATEWAY_WEBHOOK_SECRET: ${result.endpoint.signing_secret}`
          : 'Webhook endpoint registered with HMAC-SHA256 signing secret.'
      );
      await load();
    } catch (err) {
      setNotice(err.message);
    }
  };

  const sendTestWebhook = async () => {
    try {
      await api.post('/api/webhooks/test', { event_type: 'payment.succeeded' }, mode, apiKey);
      setNotice('Queued signed test webhook event for worker delivery.');
      setTimeout(load, 1200);
    } catch (err) {
      setNotice(err.message);
    }
  };

  const replay = async (id) => {
    try {
      await api.post(`/api/webhooks/deliveries/${id}/replay`, {}, mode, apiKey);
      setNotice(`Queued replay for delivery ${id.slice(0, 8)}...`);
      setTimeout(load, 1200);
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Subscribed Webhook Endpoints ({endpoints.length})</h3>
          <button onClick={sendTestWebhook} style={btn('var(--payops-accent)')}>Send Signed Test Event</button>
        </div>
        <form onSubmit={addEndpoint} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            style={{ flex: 1, padding: '0.45rem', borderRadius: 6, border: '1px solid var(--payops-border)', background: 'var(--payops-surface-soft)', color: 'var(--payops-text)' }}
          />
          <button type="submit" style={btn('var(--payops-accent)')}>Add Endpoint</button>
        </form>
        {notice && <div style={{ fontSize: '0.84rem', color: 'var(--payops-accent-ink)', marginBottom: '0.5rem' }}>{notice}</div>}
        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--payops-muted)' }}>
          {endpoints.map((ep) => (
            <li key={ep.id}>
              <code>{ep.target_url}</code> — events: {(ep.events || []).join(', ')}
            </li>
          ))}
        </ul>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Signed Delivery Audit Log & One-Click Replay</h3>
          <button onClick={load} style={btn('var(--payops-dark)')}>Refresh</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--payops-border)', textAlign: 'left', color: 'var(--payops-muted)' }}>
              <th style={pad}>Event</th>
              <th style={pad}>Target URL</th>
              <th style={pad}>Status</th>
              <th style={pad}>HTTP</th>
              <th style={pad}>Attempts</th>
              <th style={pad}>Latency</th>
              <th style={pad}>Action</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid var(--payops-border)' }}>
                <td style={pad}><code>{d.event_type}</code></td>
                <td style={pad}><code>{d.target_url}</code></td>
                <td style={pad}>{d.status}</td>
                <td style={pad}>{d.status_code || '-'}</td>
                <td style={pad}>{d.attempt_count}</td>
                <td style={pad}>{d.duration_ms ? `${d.duration_ms}ms` : '-'}</td>
                <td style={pad}>
                  <button onClick={() => replay(d.id)} style={btn('var(--payops-accent)')}>Replay</button>
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '1rem', textAlign: 'center', color: 'var(--payops-muted)' }}>
                  No webhook deliveries logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const card = { background: 'var(--payops-surface)', border: '1px solid var(--payops-border)', borderRadius: 8, padding: '1.1rem' };
const pad = { padding: '0.5rem' };
const btn = (bg) => ({
  padding: '0.4rem 0.75rem',
  borderRadius: 6,
  border: 'none',
  background: bg,
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.8rem',
});

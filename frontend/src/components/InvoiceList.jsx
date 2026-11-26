import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

export function InvoiceList({ mode, apiKey }) {
  const [invoices, setInvoices] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [schedName, setSchedName] = useState('Monthly Enterprise Retainer');
  const [schedAmount, setSchedAmount] = useState(49900);
  const [schedEmail, setSchedEmail] = useState('finance@acme.io');
  const [info, setInfo] = useState(null);

  const load = useCallback(async () => {
    try {
      const [invRes, schRes, runRes] = await Promise.all([
        api.get('/api/invoices', mode, apiKey),
        api.get('/api/billing/schedules', mode, apiKey),
        api.get('/api/billing/runs', mode, apiKey),
      ]);
      setInvoices(invRes.items || []);
      setSchedules(schRes.items || []);
      setRuns(runRes.items || []);
    } catch (err) {
      setInfo(err.message);
    }
  }, [mode, apiKey]);

  useEffect(() => {
    load();
  }, [load]);

  const createSchedule = async (e) => {
    e.preventDefault();
    try {
      await api.post(
        '/api/billing/schedules',
        { name: schedName, amount_cents: Number(schedAmount), currency: 'USD', customer_email: schedEmail },
        mode,
        apiKey
      );
      setInfo('Created recurring billing schedule.');
      await load();
    } catch (err) {
      setInfo(err.message);
    }
  };

  const triggerRun = async (id) => {
    try {
      await api.post(`/api/billing/schedules/${id}/trigger`, {}, mode, apiKey);
      setInfo('Queued async billing run + PDF invoice generation in Worker.');
      setTimeout(load, 1500);
    } catch (err) {
      setInfo(err.message);
    }
  };

  const download = async (inv) => {
    try {
      await api.downloadPdf(`/api/invoices/${inv.id}/download`, `${inv.invoice_number}.pdf`, mode, apiKey);
    } catch (err) {
      setInfo(err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Async PDF Invoices ({invoices.length})</h3>
          <button onClick={load} style={btn('var(--payops-dark)')}>Refresh</button>
        </div>
        {info && <div style={{ fontSize: '0.84rem', color: 'var(--payops-accent-ink)', marginBottom: '0.6rem' }}>{info}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--payops-border)', textAlign: 'left', color: 'var(--payops-muted)' }}>
              <th style={pad}>Invoice #</th>
              <th style={pad}>Amount</th>
              <th style={pad}>Customer</th>
              <th style={pad}>Status</th>
              <th style={pad}>Size</th>
              <th style={pad}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} style={{ borderBottom: '1px solid var(--payops-border)' }}>
                <td style={pad}><code>{inv.invoice_number}</code></td>
                <td style={pad}>{inv.currency} {(Number(inv.amount_cents) / 100).toFixed(2)}</td>
                <td style={pad}>{inv.customer_email || '-'}</td>
                <td style={pad}>{inv.status}</td>
                <td style={pad}>{inv.file_size_bytes ? `${inv.file_size_bytes} B` : '-'}</td>
                <td style={pad}>
                  {inv.status === 'ready' && (
                    <button onClick={() => download(inv)} style={btn('var(--payops-accent)')}>Download PDF</button>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: 'var(--payops-muted)' }}>
                  Complete a payment or trigger a billing run to generate PDF invoices.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Scheduled Batch Billing & Payroll Runs</h3>
        <form onSubmit={createSchedule} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr auto', gap: '0.5rem', marginBottom: '1rem' }}>
          <input value={schedName} onChange={(e) => setSchedName(e.target.value)} style={inp} placeholder="Schedule Name" />
          <input type="number" value={schedAmount} onChange={(e) => setSchedAmount(e.target.value)} style={inp} placeholder="Cents" />
          <input value={schedEmail} onChange={(e) => setSchedEmail(e.target.value)} style={inp} placeholder="Customer Email" />
          <button type="submit" style={btn('var(--payops-accent)')}>Create Schedule</button>
        </form>

        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.86rem' }}>
          {schedules.map((s) => (
            <li key={s.id} style={{ marginBottom: '0.5rem' }}>
              <strong>{s.name}</strong> — {s.currency} {(Number(s.amount_cents) / 100).toFixed(2)} ({s.cron_expr}){' '}
              <button onClick={() => triggerRun(s.id)} style={btn('var(--payops-accent)')}>Execute Run Now</button>
            </li>
          ))}
        </ul>

        {runs.length > 0 && (
          <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--payops-muted)' }}>
            Latest Runs: {runs.slice(0, 5).map((r) => `${r.schedule_name}: ${r.status}`).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

const card = { background: 'var(--payops-surface)', border: '1px solid var(--payops-border)', borderRadius: 8, padding: '1.1rem' };
const pad = { padding: '0.5rem' };
const inp = { padding: '0.45rem', borderRadius: 6, border: '1px solid var(--payops-border)', background: 'var(--payops-surface-soft)', color: 'var(--payops-text)' };
const btn = (bg) => ({
  padding: '0.4rem 0.75rem',
  borderRadius: 6,
  border: 'none',
  background: bg,
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.8rem',
});

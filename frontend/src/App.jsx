import React, { useState } from 'react';
import { DEFAULT_KEYS } from './api';
import { StatusBanner } from './components/StatusBanner';
import { PaymentsTable } from './components/PaymentsTable';
import { RoutingEditor } from './components/RoutingEditor';
import { WebhookLog } from './components/WebhookLog';
import { InvoiceList } from './components/InvoiceList';
import { RbacManager } from './components/RbacManager';
import { HostedCheckout } from './components/HostedCheckout';

const TABS = [
  { id: 'payments', label: 'Payments & Simulator' },
  { id: 'routing', label: 'Smart Routing & Chaos' },
  { id: 'webhooks', label: 'Webhooks & Replay' },
  { id: 'invoices', label: 'Invoices & Billing' },
  { id: 'rbac', label: 'RBAC & API Keys' },
];

export default function App() {
  const checkoutMatch = window.location.pathname.match(/^\/checkout\/([0-9a-f-]{36})$/i);
  if (checkoutMatch) return <HostedCheckout intentId={checkoutMatch[1]} />;

  const [mode, setMode] = useState('test');
  const [activeTab, setActiveTab] = useState('payments');
  const [customKey, setCustomKey] = useState('');

  const effectiveKey = customKey.trim() || DEFAULT_KEYS[mode];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StatusBanner mode={mode} />

      <header
        style={{
          padding: '1rem 2rem',
          background: 'var(--payops-surface)',
          borderBottom: '1px solid var(--payops-border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>PayOps Control Center</h1>
          <a
            href="/api-docs"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.82rem', color: 'var(--payops-accent-ink)', textDecoration: 'none' }}
          >
            Swagger Sandbox ↗
          </a>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password"
            placeholder={`Default: ${DEFAULT_KEYS[mode].slice(0, 14)}...`}
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            style={{
              padding: '0.35rem 0.6rem',
              borderRadius: 6,
              background: 'var(--payops-surface-soft)',
              color: 'var(--payops-text)',
              border: '1px solid var(--payops-border)',
              fontSize: '0.82rem',
              width: 220,
            }}
          />
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setCustomKey('');
            }}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: 6,
              background: mode === 'live' ? '#7f1d1d' : 'var(--payops-surface-soft)',
              color: mode === 'live' ? '#fff' : 'var(--payops-text)',
              border: '1px solid var(--payops-border)',
              fontWeight: 600,
            }}
          >
            <option value="test">TEST MODE (sk_test_)</option>
            <option value="live">LIVE MODE (sk_live_)</option>
          </select>
        </div>
      </header>

      <nav
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.75rem 2rem',
          background: 'var(--payops-page)',
          borderBottom: '1px solid var(--payops-border)',
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: 6,
              border: activeTab === t.id ? '1px solid var(--payops-accent)' : '1px solid var(--payops-border)',
              background: activeTab === t.id ? 'var(--payops-accent)' : 'var(--payops-surface)',
              color: activeTab === t.id ? '#fff' : 'var(--payops-text)',
              cursor: 'pointer',
              fontWeight: activeTab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: '1.5rem 2rem', flex: 1, maxWidth: 1280, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        {activeTab === 'payments' && <PaymentsTable mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'routing' && <RoutingEditor mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'webhooks' && <WebhookLog mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'invoices' && <InvoiceList mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'rbac' && <RbacManager mode={mode} apiKey={effectiveKey} />}
      </main>
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const POLICY_PRESETS = {
  priority_stripe_first: {
    name: 'Priority: Stripe → Paymob',
    algorithm_type: 'priority',
    config: { connectors: ['mock_stripe', 'mock_paymo'] },
  },
  priority_paymob_first: {
    name: 'Priority: Paymob → Stripe (Low Cost)',
    algorithm_type: 'priority',
    config: { connectors: ['mock_paymo', 'mock_stripe'] },
  },
  split_70_30: {
    name: 'Weighted Volume Split (70% Stripe / 30% Paymob)',
    algorithm_type: 'volume_split',
    config: {
      splits: [
        { connector: 'mock_stripe', weight: 70 },
        { connector: 'mock_paymo', weight: 30 },
      ],
    },
  },
  rule_egp_local: {
    name: 'Rule: EGP or High-Value → Paymob, Default → Stripe',
    algorithm_type: 'rule',
    config: {
      rules: [
        { currency: 'EGP', connectors: ['mock_paymo', 'mock_stripe'] },
        { min_amount_cents: 50000, connectors: ['mock_paymo', 'mock_stripe'] },
      ],
      default_connectors: ['mock_stripe', 'mock_paymo'],
    },
  },
};

export function RoutingEditor({ mode, apiKey }) {
  const [routingState, setRoutingState] = useState(null);
  const [chaos, setChaos] = useState(null);
  const [algoName, setAlgoName] = useState('Priority: Stripe → Paymob');
  const [algoType, setAlgoType] = useState('priority');
  const [configJson, setConfigJson] = useState(
    JSON.stringify({ connectors: ['mock_stripe', 'mock_paymo'] }, null, 2)
  );
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const [rData, cData] = await Promise.all([
        api.get('/api/routing', mode, apiKey),
        api.get('/api/routing/chaos', mode, apiKey).catch(() => null),
      ]);
      setRoutingState(rData);
      if (rData.active_algorithm) {
        setAlgoName(rData.active_algorithm.name);
        setAlgoType(rData.active_algorithm.algorithm_type);
        setConfigJson(JSON.stringify(rData.active_algorithm.config, null, 2));
      }
      if (cData?.gateways) setChaos(cData.gateways);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }, [mode, apiKey]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (key) => {
    const p = POLICY_PRESETS[key];
    setAlgoName(p.name);
    setAlgoType(p.algorithm_type);
    setConfigJson(JSON.stringify(p.config, null, 2));
  };

  const savePolicy = async (e) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(configJson);
      await api.put(
        '/api/routing',
        { name: algoName, algorithm_type: algoType, config: parsed },
        mode,
        apiKey
      );
      setMessage('✅ Routing algorithm hot-swapped with Redis cache invalidation.');
      await load();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const setGatewayChaos = async (gateway, forceMode) => {
    try {
      const res = await api.post(
        '/api/routing/chaos',
        { gateway, forceMode, failureRate: forceMode === 'healthy' ? 0 : 1 },
        mode,
        apiKey
      );
      setChaos(res.gateways);
      setMessage(`Updated ${gateway} chaos state to '${forceMode}'.`);
    } catch (err) {
      setMessage(`Chaos toggle failed: ${err.message}`);
    }
  };

  const resetCircuit = async (connector) => {
    try {
      await api.post('/api/routing/circuit-reset', { connector }, mode, apiKey);
      setMessage(`Circuit breaker reset to CLOSED for ${connector}.`);
      await load();
    } catch (err) {
      setMessage(`Reset failed: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div style={boxStyle}>
        <h3 style={{ marginTop: 0 }}>Live PSP Chaos & Circuit Breaker Controls</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--payops-muted)', marginTop: 0 }}>
          Simulate a real-time MockStripe outage or timeout, then switch to the Payments tab to watch automatic failover to MockPaymob.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {['mock_stripe', 'mock_paymo'].map((gw) => {
            const gwChaos = chaos?.[gw] || {};
            const tel = routingState?.telemetry?.[gw] || {};
            return (
              <div key={gw} style={{ padding: '1rem', background: 'var(--payops-surface-soft)', borderRadius: 8, border: '1px solid var(--payops-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong>{gw}</strong>
                  <span style={{ color: tel.circuit_state === 'open' ? '#b91c1c' : '#15803d', fontSize: '0.82rem' }}>
                    Circuit: {(tel.circuit_state || 'closed').toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--payops-muted)', marginBottom: '0.75rem' }}>
                  Chaos Mode: <code>{gwChaos.forceMode || 'healthy'}</code> · Approval: {tel.approval_rate_pct ?? 100}%
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <button onClick={() => setGatewayChaos(gw, 'healthy')} style={btnSmall('#15803d')}>Healthy</button>
                  <button onClick={() => setGatewayChaos(gw, 'outage')} style={btnSmall('#b91c1c')}>503 Outage</button>
                  <button onClick={() => setGatewayChaos(gw, 'soft_decline')} style={btnSmall('var(--payops-accent-ink)')}>Soft Decline</button>
                  <button onClick={() => resetCircuit(gw)} style={btnSmall('var(--payops-dark)')}>Reset Circuit</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={savePolicy} style={{ ...boxStyle, display: 'grid', gap: '0.9rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Dynamic Smart Routing Policy</h3>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => applyPreset('priority_stripe_first')} style={btnSmall('var(--payops-dark)')}>Preset: Stripe → Paymob</button>
            <button type="button" onClick={() => applyPreset('priority_paymob_first')} style={btnSmall('var(--payops-dark)')}>Preset: Paymob → Stripe</button>
            <button type="button" onClick={() => applyPreset('split_70_30')} style={btnSmall('var(--payops-dark)')}>Preset: 70/30 Split</button>
            <button type="button" onClick={() => applyPreset('rule_egp_local')} style={btnSmall('var(--payops-dark)')}>Preset: Currency/Amount Rule</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
          <input value={algoName} onChange={(e) => setAlgoName(e.target.value)} style={fieldStyle} placeholder="Policy Name" />
          <select value={algoType} onChange={(e) => setAlgoType(e.target.value)} style={fieldStyle}>
            <option value="priority">priority</option>
            <option value="volume_split">volume_split</option>
            <option value="rule">rule</option>
            <option value="single">single</option>
          </select>
        </div>

        <textarea
          rows={8}
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
          style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: '0.85rem' }}
        />

        <div>
          <button type="submit" style={btnSmall('var(--payops-accent)')}>Activate Routing Policy (Zero Restart)</button>
        </div>

        {message && <div style={{ fontSize: '0.85rem', color: 'var(--payops-accent-ink)' }}>{message}</div>}
      </form>
    </div>
  );
}

const boxStyle = { background: 'var(--payops-surface)', border: '1px solid var(--payops-border)', borderRadius: 8, padding: '1.1rem' };
const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.5rem',
  borderRadius: 6,
  border: '1px solid var(--payops-border)',
  background: 'var(--payops-surface-soft)',
  color: 'var(--payops-text)',
};
const btnSmall = (bg) => ({
  padding: '0.4rem 0.7rem',
  borderRadius: 5,
  border: 'none',
  background: bg,
  color: '#fff',
  fontSize: '0.8rem',
  cursor: 'pointer',
});

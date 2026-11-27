import React, { useEffect, useState } from 'react';

export function StatusBanner({ mode }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/status?mode=${mode}`);
        const data = await res.json();
        if (mounted) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err.message);
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [mode]);

  const healthy = status?.status === 'operational' && !error;

  return (
    <div
      style={{
        background: healthy ? '#064e3b' : '#7f1d1d',
        color: '#fff',
        borderBottom: '1px solid var(--payops-border)',
        padding: '0.5rem 1.5rem',
        fontSize: '0.8rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1.25rem',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>
          {healthy ? '● SYSTEM OPERATIONAL' : '▲ SYSTEM DEGRADED / OFFLINE'}
        </span>
        {status && (
          <>
            <span>Host: <code>{status.hostname}</code></span>
            <span>AZ: <code>{status.availability_zone}</code></span>
            <span>Commit: <code>{String(status.git_commit_sha).slice(0, 8)}</code></span>
            <span>Build: <code>#{status.jenkins_build_number}</code></span>
          </>
        )}
        {error && <span>Backend unreachable ({error})</span>}
      </div>

      {status?.dependencies && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span>
            PG: <strong>{status.dependencies.postgresql?.healthy ? `${status.dependencies.postgresql.latency_ms}ms` : 'DOWN'}</strong>
          </span>
          <span>
            Redis: <strong>{status.dependencies.redis?.healthy ? `${status.dependencies.redis.latency_ms}ms` : 'DOWN'}</strong>
          </span>
          {status.connectors &&
            Object.entries(status.connectors).map(([name, c]) => (
              <span
                key={name}
                style={{
                  padding: '0.1rem 0.45rem',
                  borderRadius: 4,
                  background: c.circuit_state === 'open' ? '#ef4444' : 'var(--payops-dark)',
                }}
              >
                {name}: {c.circuit_state.toUpperCase()} ({c.approval_rate_pct}%)
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

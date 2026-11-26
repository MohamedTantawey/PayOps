const API_BASE = import.meta.env.VITE_API_URL || '';

export const DEFAULT_KEYS = {
  test: 'sk_test_demo_000000000000000000000000',
  live: 'sk_live_demo_000000000000000000000000',
};

function resolveKey(mode, customKey) {
  if (customKey && customKey.trim()) return customKey.trim();
  return mode === 'live' ? DEFAULT_KEYS.live : DEFAULT_KEYS.test;
}

async function request(method, endpoint, { body, mode = 'test', apiKey, headers = {} } = {}) {
  const token = resolveKey(mode, apiKey);
  const reqHeaders = {
    'X-PayOps-Mode': mode,
    Authorization: `Bearer ${token}`,
    ...headers,
  };
  if (body !== undefined) {
    reqHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  get(endpoint, mode = 'test', apiKey) {
    return request('GET', endpoint, { mode, apiKey });
  },

  post(endpoint, body, mode = 'test', apiKey, extraHeaders = {}) {
    return request('POST', endpoint, { body, mode, apiKey, headers: extraHeaders });
  },

  put(endpoint, body, mode = 'test', apiKey) {
    return request('PUT', endpoint, { body, mode, apiKey });
  },

  async downloadPdf(endpoint, filename, mode = 'test', apiKey) {
    const token = resolveKey(mode, apiKey);
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'X-PayOps-Mode': mode,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Download failed (${res.status}): ${errText}`);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'invoice.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

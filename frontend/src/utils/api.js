const BASE = ''; // proxy-based; vite forwards /api → backend

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const token = localStorage.getItem('foundapay_token');
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: finalHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

api.get    = (p, opts)        => api(p, { ...opts, method: 'GET' });
api.post   = (p, body, opts)  => api(p, { ...opts, method: 'POST', body });
api.put    = (p, body, opts)  => api(p, { ...opts, method: 'PUT', body });
api.patch  = (p, body, opts)  => api(p, { ...opts, method: 'PATCH', body });
api.delete = (p, opts)        => api(p, { ...opts, method: 'DELETE' });

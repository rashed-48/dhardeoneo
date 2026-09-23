const TOKEN_KEY = 'shelf.token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (t) => {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — session-only auth is fine */
  }
};

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === '' || v == null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  config: () => request('/config', { auth: false }),

  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload, auth: false }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload, auth: false }),
  me: () => request('/auth/me'),
  updateMe: (payload) => request('/auth/me', { method: 'PATCH', body: payload }),

  listings: (params) => request(`/listings${qs(params)}`),
  listingMeta: () => request('/listings/meta'),
  coverLookup: (title, author) => request(`/listings/cover-lookup${qs({ title, author })}`),
  listing: (id, params) => request(`/listings/${id}${qs(params)}`),
  createListing: (payload) => request('/listings', { method: 'POST', body: payload }),
  updateListing: (id, payload) => request(`/listings/${id}`, { method: 'PATCH', body: payload }),
  deleteListing: (id) => request(`/listings/${id}`, { method: 'DELETE' }),

  rentals: (role) => request(`/rentals${qs({ role })}`),
  requestRental: (payload) => request('/rentals', { method: 'POST', body: payload }),
  rentalAction: (id, action) => request(`/rentals/${id}/${action}`, { method: 'POST' }),
  payRental: (id, card) => request(`/rentals/${id}/pay`, { method: 'POST', body: card }),
  reviewRental: (id, payload) => request(`/rentals/${id}/review`, { method: 'POST', body: payload }),
};

// Authentication uses a secure HttpOnly session cookie; no token is exposed to JavaScript.

/**
 * The session can lapse while the app is open. These endpoints answer 401 as a
 * normal result — signed out on boot, or wrong password — so they must not be
 * mistaken for a session that just expired.
 */
const EXPECTS_401 = new Set(['/auth/me', '/auth/login', '/auth/signup', '/auth/logout']);

let onUnauthorized = () => {};

/** AppContext registers the handler that signs the user out and redirects. */
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = typeof fn === 'function' ? fn : () => {};
};

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // Carries the HTTP status so callers can tell a 401 from a 500.
    const err = /** @type {Error & { status?: number }} */ (
      new Error(data.error || `Request failed (${res.status})`)
    );
    err.status = res.status;
    if (res.status === 401 && !EXPECTS_401.has(path.split('?')[0])) onUnauthorized();
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
  config: () => request('/config'),
  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  updateMe: (payload) => request('/auth/me', { method: 'PATCH', body: payload }),
  listings: (params) => request(`/listings${qs(params)}`),
  listingMeta: () => request('/listings/meta'),
  coverLookup: (title, author, language) => request(`/listings/cover-lookup${qs({ title, author, language })}`),
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

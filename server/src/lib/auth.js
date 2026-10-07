import crypto from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';

import { IS_PRODUCTION } from './paths.js';

/**
 * A shipped default secret would let anyone mint a valid token, so production
 * never falls back to one. If the host has not set SHELF_SECRET we generate a
 * random one per boot: sessions then end at every restart, which is annoying
 * but safe, and the warning says how to fix it.
 */
function resolveSecret() {
  const configured = process.env.SHELF_SECRET;
  if (configured && configured.length >= 16) return configured;

  if (!IS_PRODUCTION) return 'shelf-dev-secret-change-me';

  if (configured) {
    console.warn('[shelf] SHELF_SECRET is too short (need 16+ characters); ignoring it.');
  }
  console.warn(
    '[shelf] SHELF_SECRET is not set. Using a random secret for this process — ' +
      'everyone will be logged out on restart. Set SHELF_SECRET to fix this.'
  );
  return crypto.randomBytes(48).toString('hex');
}

const SECRET = resolveSecret();
const COOKIE_NAME = 'shelf_session';
const CLAIMS = { issuer: 'shelf', audience: 'shelf-web' };

/**
 * Sessions time out on inactivity rather than on a fixed clock: the cookie is
 * reissued while someone is using the site, so they are never signed out
 * mid-task, and it lapses IDLE_WINDOW after they stop. ABSOLUTE_MAX caps how
 * long that sliding can continue, so a stolen cookie cannot live forever.
 */
const idleMinutes = Number(process.env.SHELF_SESSION_IDLE_MINUTES);
const IDLE_WINDOW_MS =
  Number.isFinite(idleMinutes) && idleMinutes >= 1 && idleMinutes <= 60 * 24
    ? idleMinutes * 60 * 1000
    : 30 * 60 * 1000; // 30 minutes of inactivity
const ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days since signing in
const REFRESH_AFTER_MS = IDLE_WINDOW_MS / 2; // reissue past the halfway point

const cookieOptions = () => ({
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: 'lax',
  path: '/',
  maxAge: IDLE_WINDOW_MS,
});

/**
 * scrypt is deliberately slow, which is the point for a password hash and the
 * reason it must not run synchronously: the synchronous form blocks the event
 * loop for the whole derivation, so concurrent sign-ins queue behind each other
 * and every other request on the server stalls with them. The callback form
 * runs on libuv's thread pool instead, leaving the loop free.
 */
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = await scrypt(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return candidate.length === known.length && crypto.timingSafeEqual(candidate, known);
}

/**
 * `sat` (session started at) survives every refresh, so the absolute cap is
 * measured from the original sign-in rather than from the latest reissue.
 */
export const signToken = (user, sessionStartedAt = Date.now()) =>
  jwt.sign({ uid: user.id, sat: sessionStartedAt }, SECRET, {
    ...CLAIMS,
    expiresIn: Math.floor(IDLE_WINDOW_MS / 1000),
  });

export function setSession(res, user, sessionStartedAt) {
  res.cookie(COOKIE_NAME, signToken(user, sessionStartedAt), cookieOptions());
}

export function clearSession(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

/**
 * True once a session is past the halfway point of its idle window, unless it
 * has already slid for longer than the absolute cap allows. Pure, so the rule
 * can be tested without waiting half an hour.
 *
 * @param {{startedAt: number, expiresAt: number}} session
 */
export function shouldRefresh({ startedAt, expiresAt }, now = Date.now()) {
  if (now >= expiresAt) return false; // already lapsed; let it go
  if (now - startedAt >= ABSOLUTE_MAX_MS) return false;
  const elapsed = IDLE_WINDOW_MS - (expiresAt - now);
  return elapsed >= REFRESH_AFTER_MS;
}

export const SESSION_LIMITS = {
  idleWindowMs: IDLE_WINDOW_MS,
  absoluteMaxMs: ABSOLUTE_MAX_MS,
  refreshAfterMs: REFRESH_AFTER_MS,
};

function readCookie(req, name) {
  const pairs = String(req.headers.cookie || '').split(';');
  for (const pair of pairs) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function userFromRequest(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  try {
    const claims = jwt.verify(token, SECRET, { ...CLAIMS, algorithms: ['HS256'] });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.uid);
    if (!user) return null;

    // Tokens issued before `sat` existed are treated as starting now; they
    // still expire on the idle window, they just get one more sliding period.
    const startedAt = Number(claims.sat) || Date.now();
    return { user, startedAt, expiresAt: claims.exp * 1000 };
  } catch {
    return null;
  }
}

/**
 * Attaches req.user when a valid cookie is present, and slides the session
 * forward once it is past the halfway mark — never rejects.
 */
export function attachUser(req, res, next) {
  const session = userFromRequest(req);
  req.user = session?.user ?? null;
  if (!session) return next();

  // Only API traffic slides the session. Putting Set-Cookie on an immutable
  // asset response would stop caches storing it.
  if (!req.path.startsWith('/api')) return next();

  if (shouldRefresh(session)) setSession(res, session.user, session.startedAt);
  next();
}

/** Hard gate for routes that need a signed-in user. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}

export const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    area: u.area,
    lat: u.lat,
    lng: u.lng,
    bio: u.bio,
    createdAt: u.created_at,
  };

import crypto from 'node:crypto';
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

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return candidate.length === known.length && crypto.timingSafeEqual(candidate, known);
}

export const signToken = (user) =>
  jwt.sign({ uid: user.id }, SECRET, { expiresIn: '30d' });

function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const { uid } = jwt.verify(token, SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || null;
  } catch {
    return null;
  }
}

/** Attaches req.user when a valid token is present, but never rejects. */
export function attachUser(req, _res, next) {
  req.user = userFromRequest(req);
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

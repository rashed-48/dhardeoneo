import { Router } from 'express';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  setSession,
  clearSession,
  requireAuth,
  publicUser,
} from '../lib/auth.js';
import { AREAS } from '../lib/geo.js';
import { rateLimit } from '../lib/rateLimit.js';

const router = Router();

/**
 * A well-formed hash that no password matches. Checking against it when the
 * email is unknown makes a missing account cost the same scrypt work as a wrong
 * password, so response time cannot be used to discover registered emails.
 */
const ABSENT_USER_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

const normaliseEmail = (value) => String(value || '').trim().toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

function locationFor(areaName) {
  const area = AREAS.find((candidate) => candidate.name === String(areaName || '').trim());
  if (!area) throw new Error('Choose a valid area.');
  return area;
}

router.post('/signup', rateLimit({ windowMs: 15 * 60_000, max: 5 }), async (req, res) => {
  const { name, email, password, phone = '', area = '', lat = null, lng = null } =
    req.body || {};

  const cleanName = String(name || '').trim();
  const cleanEmail = normaliseEmail(email);
  const cleanPassword = String(password || '');
  if (!cleanName || !cleanEmail || !cleanPassword)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (cleanName.length > 120 || !validEmail(cleanEmail))
    return res.status(400).json({ error: 'Enter a valid name and email address.' });
  if (cleanPassword.length < 10 || cleanPassword.length > 256)
    return res.status(400).json({ error: 'Password must be 10 to 256 characters.' });

  let location;
  try {
    location = locationFor(area);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const cleanPhone = String(phone || '').trim();
  if (cleanPhone.length > 40)
    return res.status(400).json({ error: 'Phone number is too long.' });

  const taken = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(cleanEmail);
  if (taken) return res.status(409).json({ error: 'That email is already registered.' });

  let passwordHash;
  try {
    passwordHash = await hashPassword(cleanPassword);
  } catch {
    return res.status(500).json({ error: 'Could not create the account. Try again.' });
  }

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, phone, area, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanName, cleanEmail, passwordHash, cleanPhone,
      location.name, location.lat, location.lng
    );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  setSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', rateLimit({ windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = normaliseEmail(email);
  const cleanPassword = String(password || '');
  if (!validEmail(cleanEmail) || cleanPassword.length > 256)
    return res.status(401).json({ error: 'Wrong email or password.' });
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(cleanEmail);

  let matches = false;
  try {
    matches = await verifyPassword(cleanPassword, user ? user.password_hash : ABSENT_USER_HASH);
  } catch {
    matches = false;
  }
  if (!user || !matches)
    return res.status(401).json({ error: 'Wrong email or password.' });

  setSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', requireAuth, (req, res) => {
  const { name, phone, area, lat, lng, bio } = req.body || {};
  const u = req.user;
  const nextName = name === undefined ? u.name : String(name).trim();
  const nextPhone = phone === undefined ? u.phone : String(phone).trim();
  const nextBio = bio === undefined ? u.bio : String(bio).trim();
  if (!nextName || nextName.length > 120 || nextPhone.length > 40 || nextBio.length > 1000)
    return res.status(400).json({ error: 'Profile details are not valid.' });

  let location;
  try {
    location = area === undefined ? { name: u.area, lat: u.lat, lng: u.lng } : locationFor(area);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  db.prepare(
    `UPDATE users SET name = ?, phone = ?, area = ?, lat = ?, lng = ?, bio = ?
     WHERE id = ?`
  ).run(
    nextName, nextPhone, location.name, location.lat, location.lng, nextBio,
    u.id
  );
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  res.json({ user: publicUser(fresh) });
});

export default router;

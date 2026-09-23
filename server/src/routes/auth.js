import { Router } from 'express';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  publicUser,
} from '../lib/auth.js';

const router = Router();

router.post('/signup', (req, res) => {
  const { name, email, password, phone = '', area = '', lat = null, lng = null } =
    req.body || {};

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const taken = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(String(email).toLowerCase());
  if (taken) return res.status(409).json({ error: 'That email is already registered.' });

  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, phone, area, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(email).toLowerCase().trim(),
      hashPassword(String(password)),
      String(phone),
      String(area),
      lat == null ? null : Number(lat),
      lng == null ? null : Number(lng)
    );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email || '').toLowerCase().trim());

  if (!user || !verifyPassword(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Wrong email or password.' });

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', requireAuth, (req, res) => {
  const { name, phone, area, lat, lng, bio } = req.body || {};
  const u = req.user;
  db.prepare(
    `UPDATE users SET name = ?, phone = ?, area = ?, lat = ?, lng = ?, bio = ?
     WHERE id = ?`
  ).run(
    name ?? u.name,
    phone ?? u.phone,
    area ?? u.area,
    lat === undefined ? u.lat : lat === null ? null : Number(lat),
    lng === undefined ? u.lng : lng === null ? null : Number(lng),
    bio ?? u.bio,
    u.id
  );
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  res.json({ user: publicUser(fresh) });
});

export default router;

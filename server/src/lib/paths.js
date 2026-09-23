import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.join(here, '..', '..');
export const REPO_ROOT = path.join(SERVER_ROOT, '..');

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Writable state lives under one directory so a host can mount a single volume
 * and keep the database across deploys. Without a volume the app still works —
 * it just re-seeds itself on boot.
 */
export const DATA_DIR = process.env.SHELF_DATA_DIR
  ? path.resolve(process.env.SHELF_DATA_DIR)
  : SERVER_ROOT;

export const DB_PATH = process.env.SHELF_DB
  ? path.resolve(process.env.SHELF_DB)
  : path.join(DATA_DIR, 'shelf.db');

/**
 * Cover art is baked into the image at build time, so it defaults to the repo
 * rather than the data volume. Point SHELF_COVERS_DIR at the volume if you want
 * lender-uploaded covers to survive a redeploy.
 */
export const BUNDLED_COVERS_DIR = path.join(SERVER_ROOT, 'covers');

export const COVERS_DIR = process.env.SHELF_COVERS_DIR
  ? path.resolve(process.env.SHELF_COVERS_DIR)
  : BUNDLED_COVERS_DIR;

/** Built SPA, served by this process in production. */
export const WEB_DIST = process.env.SHELF_WEB_DIST
  ? path.resolve(process.env.SHELF_WEB_DIST)
  : path.join(REPO_ROOT, 'web', 'dist');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

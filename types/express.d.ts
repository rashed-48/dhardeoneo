/**
 * `attachUser` puts the signed-in user on the request and `requireAuth` makes
 * it non-optional for the routes behind it, but Express's own Request type
 * knows nothing about that. Declaring it here both silences two dozen false
 * reports and writes the middleware's contract down somewhere checkable.
 */
import 'express';

/** A row from the users table, as the routes receive it. */
export interface ShelfUser {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  phone: string | null;
  area: string;
  lat: number | null;
  lng: number | null;
  bio: string;
  created_at: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `attachUser`; guaranteed present behind `requireAuth`. */
    user?: ShelfUser | null;
  }
}

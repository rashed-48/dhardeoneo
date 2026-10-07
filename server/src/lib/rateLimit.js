/**
 * Small in-process limiter for this single-container application. It protects
 * expensive authentication and cover-search work without adding a paid service.
 * Move this to Redis (or the edge) if the app is ever scaled horizontally.
 */
const buckets = new Map();

export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = `${key(req)}:${req.path}`;
    const bucket = buckets.get(bucketKey);
    const current = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + windowMs };
    current.count += 1;
    buckets.set(bucketKey, current);

    // Bound memory even if somebody sprays unique source addresses at this app.
    if (buckets.size > 10_000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
    }

    if (current.count <= max) return next();
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many attempts. Please try again shortly.' });
  };
}

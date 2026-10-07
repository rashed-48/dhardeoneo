import { Router } from 'express';

const METHODS = ['get', 'post', 'patch', 'put', 'delete'];

/**
 * A Router whose handlers may be async.
 *
 * Express 4 ignores a rejected promise returned from a handler: the request
 * hangs until it times out and the error never reaches the error middleware.
 * Since every route now awaits the database, wrapping once here is safer than
 * remembering a try/catch in seventeen places.
 *
 * Handlers taking four arguments are error middleware and are left alone.
 */
export function asyncRouter() {
  const router = Router();

  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) =>
      original(
        path,
        ...handlers.map((handler) =>
          typeof handler === 'function' && handler.length < 4
            ? (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
            : handler
        )
      );
  }

  return router;
}

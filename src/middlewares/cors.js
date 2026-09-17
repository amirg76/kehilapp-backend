import { CSRF_HEADER } from '../config/cookies.js';
import { isKnownNonProduction } from '../config/environment.js';

/**
 * CORS with a fixed origin allowlist.
 *
 * This previously reflected any Origin back while also sending
 * Allow-Credentials: true — which authorises every website on the internet to
 * make credentialed cross-origin requests. Harmless only as long as auth stays
 * a Bearer header; a latent account-takeover the moment a cookie is introduced.
 *
 * Allowed origins come from ALLOWED_ORIGINS (comma-separated). In development,
 * with none set, localhost is permitted so the frontend can talk to the API.
 */
const parseAllowed = () => {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  // Dev fallback only, and gated DEFAULT-DENY. The question asked here is not
  // "is this production" (isProduction(), which answers false for 'staging', for
  // a typo and for an unset NODE_ENV — and every one of those false answers put
  // localhost back on the allowlist next to Allow-Credentials: true). It is "is
  // this PROVABLY development" — the safe list decides, exactly as it does in the
  // two destructive scripts and in config/cookies.js.
  //
  // src/index.js already refuses to boot on an unrecognised NODE_ENV, so a
  // running server can never reach the ambiguous case. This module is also
  // imported directly by tests, which do not pass that check, so it does not
  // lean on it.
  return isKnownNonProduction() ? ['http://localhost:5173', 'http://localhost:3000'] : [];
};

const ALLOWED_ORIGINS = parseAllowed();

const corsMiddleware = (req, res, next) => {
  const origin = req.get('Origin');

  // Echo the origin only when it is on the allowlist — never a blanket '*',
  // and never an unknown origin.
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
  res.header('Access-Control-Expose-Headers', 'Content-Length, X-Total-Count, X-Page, X-Page-Size');
  // X-CSRF-Token MUST be listed here. The double-submit defence has the SPA send
  // that header on every mutating request; a cross-origin mutating request is
  // preflighted, and a browser blocks the real request whenever a requested
  // header is missing from this list. Omitting it made every cross-origin write
  // fail in the browser while curl — which does not preflight — kept working.
  res.header(
    'Access-Control-Allow-Headers',
    `Accept, Authorization, Content-Type, X-Requested-With, Range, ${CSRF_HEADER}`,
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
};

export default corsMiddleware;

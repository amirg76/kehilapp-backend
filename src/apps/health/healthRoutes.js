import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * Liveness + readiness in one place.
 *
 * GET /healthz  — "is the process up": always 200 if Express can answer at all.
 *                 Load balancers and uptime monitors poll this.
 * GET /readyz   — "can it do real work": 200 only when Mongo is connected,
 *                 503 otherwise. Deploy tooling waits on this before routing
 *                 traffic to a new instance.
 *
 * Both are unauthenticated by design (and allowlisted in the route-guard test):
 * a health check that needs a token fails exactly when you need it most.
 * Neither leaks internals — no versions, no connection strings, no hostnames.
 */
router.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/readyz', (req, res) => {
  // 1 === connected. 0/2/3 are disconnected/connecting/disconnecting.
  const dbReady = mongoose.connection.readyState === 1;

  if (!dbReady) {
    return res.status(503).json({ status: 'unavailable', db: 'down' });
  }

  return res.status(200).json({ status: 'ok', db: 'up' });
});

export default router;

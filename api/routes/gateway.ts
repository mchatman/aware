import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { gateways } from '../db/schema.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /gateway/status
router.get('/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [gateway] = await db
      .select()
      .from(gateways)
      .where(eq(gateways.userId, req.userId!))
      .limit(1);

    if (!gateway) {
      res.status(404).json({ error: 'No gateway found for this user' });
      return;
    }

    const endpoint = `https://aw-${gateway.shortId}.fly.dev`;

    res.json({
      shortId: gateway.shortId,
      status: gateway.status,
      endpoint,
      token: gateway.token,
      region: gateway.region,
      machineId: gateway.machineId,
      ready: gateway.status === 'running',
      createdAt: gateway.createdAt,
    });
  } catch (err) {
    console.error('[gateway/status] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

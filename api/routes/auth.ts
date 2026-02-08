import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users, gateways } from '../db/schema.js';
import { signToken } from '../services/jwt.js';
import { provisionGateway } from '../services/provisioner.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const router = Router();

function deriveEndpoint(shortId: string): string {
  return `https://aw-${shortId}.fly.dev`;
}

// POST /auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check if user already exists
    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(users)
      .values({ email: email.toLowerCase(), passwordHash })
      .returning();

    // Create gateway
    const shortId = nanoid(8);
    const gatewayToken = crypto.randomBytes(32).toString('hex');
    const [gateway] = await db
      .insert(gateways)
      .values({
        userId: user.id,
        shortId,
        token: gatewayToken,
        status: 'provisioning',
      })
      .returning();

    // Start async provisioning (don't await)
    provisionGateway(user.id, gateway.id, shortId, gatewayToken, gateway.region).catch((err) =>
      console.error('[signup] Provisioning error:', err),
    );

    // Return JWT
    const jwt = await signToken(user.id);

    res.status(201).json({
      token: jwt,
      user: { id: user.id, email: user.email },
      gateway: {
        shortId: gateway.shortId,
        status: gateway.status,
        endpoint: deriveEndpoint(gateway.shortId),
        token: gateway.token,
      },
    });
  } catch (err) {
    console.error('[signup] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const [gateway] = await db.select().from(gateways).where(eq(gateways.userId, user.id)).limit(1);

    const jwt = await signToken(user.id);

    res.json({
      token: jwt,
      user: { id: user.id, email: user.email },
      gateway: gateway
        ? {
            shortId: gateway.shortId,
            status: gateway.status,
            endpoint: deriveEndpoint(gateway.shortId),
            token: gateway.token,
          }
        : null,
    });
  } catch (err) {
    console.error('[login] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [gateway] = await db.select().from(gateways).where(eq(gateways.userId, user.id)).limit(1);

    res.json({
      user: { id: user.id, email: user.email },
      gateway: gateway
        ? {
            shortId: gateway.shortId,
            status: gateway.status,
            endpoint: deriveEndpoint(gateway.shortId),
            region: gateway.region,
          }
        : null,
    });
  } catch (err) {
    console.error('[me] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

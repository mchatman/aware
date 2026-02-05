import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { googleConnections } from '../db/schema.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { signToken, verifyToken } from '../services/jwt.js';
import { buildAuthUrl, exchangeCode, getUserEmail, refreshAccessToken } from '../services/google.js';

const router = Router();

// GET /auth/google — redirect to Google OAuth consent screen
// Accepts token via Authorization header OR ?token= query param (for browser redirects).
router.get('/', async (req: AuthRequest, res) => {
  try {
    // Try header first, then query param.
    const header = req.headers.authorization;
    const tokenFromHeader = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : null;
    const token = tokenFromHeader ?? tokenFromQuery;

    if (!token) {
      res.status(401).json({ error: 'Missing token — pass as Authorization header or ?token= query param' });
      return;
    }

    req.userId = await verifyToken(token);

    // Encode the user ID in the state param so we know who to associate tokens with.
    const state = await signToken(req.userId);
    const url = buildAuthUrl(state);
    res.redirect(url);
  } catch (err) {
    console.error('[google/auth] Error:', err);
    res.status(500).json({ error: 'Failed to build auth URL' });
  }
});

// GET /auth/google/callback — Google redirects here after consent
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      res.status(400).send(closePage('Authorization denied', String(oauthError)));
      return;
    }

    if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
      res.status(400).send(closePage('Missing parameters', 'Invalid callback'));
      return;
    }

    // Verify the state param to get the user ID.
    const userId = await verifyToken(state);

    // Exchange the authorization code for tokens.
    const tokens = await exchangeCode(code);

    if (!tokens.refresh_token) {
      res.status(400).send(closePage('Missing refresh token', 'Please revoke access at myaccount.google.com and try again.'));
      return;
    }

    // Get the Google email for display.
    const email = await getUserEmail(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Upsert — one Google connection per user.
    const existing = await db
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(googleConnections)
        .set({
          email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          scopes: tokens.scope,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(googleConnections.userId, userId));
    } else {
      await db.insert(googleConnections).values({
        userId,
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scopes: tokens.scope,
        expiresAt,
      });
    }

    console.log(`[google/callback] Connected Google account ${email} for user ${userId}`);
    res.send(closePage('Google connected!', `Signed in as ${email}. You can close this window.`));
  } catch (err) {
    console.error('[google/callback] Error:', err);
    res.status(500).send(closePage('Connection failed', 'Something went wrong. Please try again.'));
  }
});

// GET /auth/google/status — check if Google is connected
router.get('/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [conn] = await db
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.userId, req.userId!))
      .limit(1);

    if (!conn) {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      email: conn.email,
      scopes: conn.scopes,
      connectedAt: conn.createdAt,
    });
  } catch (err) {
    console.error('[google/status] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/google/token — gateway calls this to get a fresh access token
router.get('/token', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [conn] = await db
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.userId, req.userId!))
      .limit(1);

    if (!conn) {
      res.status(404).json({ error: 'Google not connected' });
      return;
    }

    // If token is expired or expiring in <5 min, refresh it.
    const needsRefresh = conn.expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (needsRefresh) {
      try {
        const refreshed = await refreshAccessToken(conn.refreshToken);
        const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

        await db
          .update(googleConnections)
          .set({
            accessToken: refreshed.access_token,
            expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(googleConnections.userId, req.userId!));

        res.json({
          accessToken: refreshed.access_token,
          email: conn.email,
          expiresAt: expiresAt.toISOString(),
        });
        return;
      } catch (err) {
        console.error('[google/token] Refresh failed:', err);
        res.status(502).json({ error: 'Failed to refresh Google token' });
        return;
      }
    }

    res.json({
      accessToken: conn.accessToken,
      email: conn.email,
      expiresAt: conn.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[google/token] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /auth/google — disconnect Google
router.delete('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await db
      .delete(googleConnections)
      .where(eq(googleConnections.userId, req.userId!));

    res.json({ disconnected: true });
  } catch (err) {
    console.error('[google/disconnect] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MARK: Helpers

function closePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #fff;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 400px; padding: 40px; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;

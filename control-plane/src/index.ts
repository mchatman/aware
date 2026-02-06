import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import pg from 'pg';

const { Pool } = pg;

const app = new Hono();

// Config
const PORT = parseInt(process.env.PORT || '3000');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const GATEWAY_ENDPOINT = process.env.GATEWAY_ENDPOINT || 'wss://aware-qunsbw.fly.dev';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '4483530cf746a6f894e3432728f53a462e929756be523091b5a76266d87f36cd';
const DATABASE_URL = process.env.DATABASE_URL;

// Google OAuth Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://aware-api.fly.dev/auth/google/callback';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

// Postgres pool
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

// Initialize database
async function initDb() {
  if (!pool) {
    console.log('No DATABASE_URL - using in-memory storage (data will not persist)');
    return;
  }
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS google_tokens (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        google_email TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    console.log('Database initialized');
  } catch (e) {
    console.error('Failed to initialize database:', e);
    throw e;
  }
}

// In-memory fallback
const usersMemory: Map<string, { id: string; email: string; passwordHash: string }> = new Map();
const googleTokensMemory: Map<string, { 
  userId: string; 
  googleEmail: string; 
  accessToken: string; 
  refreshToken: string; 
  expiresAt: Date 
}> = new Map();

// Database operations
async function findUserByEmail(email: string) {
  if (pool) {
    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.id, email: row.email, passwordHash: row.password_hash };
  }
  return usersMemory.get(email) || null;
}

async function findUserById(id: string) {
  if (pool) {
    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.id, email: row.email, passwordHash: row.password_hash };
  }
  for (const user of usersMemory.values()) {
    if (user.id === id) return user;
  }
  return null;
}

async function createUser(id: string, email: string, passwordHash: string) {
  if (pool) {
    await pool.query(
      'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
      [id, email, passwordHash]
    );
  } else {
    usersMemory.set(email, { id, email, passwordHash });
  }
}

async function userExists(email: string): Promise<boolean> {
  if (pool) {
    const result = await pool.query(
      'SELECT 1 FROM users WHERE email = $1',
      [email]
    );
    return result.rows.length > 0;
  }
  return usersMemory.has(email);
}

// Google token operations
async function getGoogleTokens(userId: string) {
  if (pool) {
    const result = await pool.query(
      'SELECT google_email, access_token, refresh_token, expires_at FROM google_tokens WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      googleEmail: row.google_email,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    };
  }
  return googleTokensMemory.get(userId) || null;
}

async function saveGoogleTokens(
  userId: string, 
  googleEmail: string, 
  accessToken: string, 
  refreshToken: string, 
  expiresAt: Date
) {
  if (pool) {
    await pool.query(`
      INSERT INTO google_tokens (user_id, google_email, access_token, refresh_token, expires_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        google_email = $2,
        access_token = $3,
        refresh_token = COALESCE(NULLIF($4, ''), google_tokens.refresh_token),
        expires_at = $5,
        updated_at = NOW()
    `, [userId, googleEmail, accessToken, refreshToken, expiresAt]);
  } else {
    googleTokensMemory.set(userId, { userId, googleEmail, accessToken, refreshToken, expiresAt });
  }
}

async function deleteGoogleTokens(userId: string) {
  if (pool) {
    await pool.query('DELETE FROM google_tokens WHERE user_id = $1', [userId]);
  } else {
    googleTokensMemory.delete(userId);
  }
}

// Refresh Google access token if expired
async function refreshGoogleToken(userId: string): Promise<string | null> {
  const tokens = await getGoogleTokens(userId);
  if (!tokens) return null;
  
  // If not expired yet (with 5 min buffer), return current token
  if (tokens.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return tokens.accessToken;
  }
  
  // Refresh the token
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    
    if (!response.ok) {
      console.error('Failed to refresh Google token:', await response.text());
      return null;
    }
    
    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    
    await saveGoogleTokens(
      userId,
      tokens.googleEmail,
      data.access_token,
      data.refresh_token || '', // May not be returned on refresh
      expiresAt
    );
    
    return data.access_token;
  } catch (e) {
    console.error('Error refreshing Google token:', e);
    return null;
  }
}

app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ 
  status: 'ok', 
  db: pool ? 'postgres' : 'memory',
  googleConfigured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
}));

// Helper to generate JWT
function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '30d' });
}

// Helper to verify JWT and get user ID
function verifyToken(authHeader: string | undefined): { userId: string; email: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.slice(7);
    return jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
  } catch {
    return null;
  }
}

// Helper to build gateway response
function gatewayResponse() {
  return {
    shortId: 'aw-prod',
    status: 'active',
    endpoint: GATEWAY_ENDPOINT,
    token: GATEWAY_TOKEN,
    region: 'sjc',
    ready: true,
  };
}

// POST /auth/signup
app.post('/auth/signup', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    if (!email || !password) {
      return c.json({ error: 'Email and password required' }, 400);
    }
    
    const emailLower = email.toLowerCase().trim();
    
    if (await userExists(emailLower)) {
      return c.json({ error: 'Email already registered' }, 400);
    }
    
    if (password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }
    
    const id = nanoid();
    const passwordHash = await bcrypt.hash(password, 12);
    
    await createUser(id, emailLower, passwordHash);
    
    const token = generateToken(id, emailLower);
    
    return c.json({
      token,
      user: { id, email: emailLower },
      gateway: gatewayResponse(),
    }, 201);
  } catch (e) {
    console.error('Signup error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /auth/login
app.post('/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    if (!email || !password) {
      return c.json({ error: 'Email and password required' }, 400);
    }
    
    const emailLower = email.toLowerCase().trim();
    const user = await findUserByEmail(emailLower);
    
    if (!user) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    
    const token = generateToken(user.id, user.email);
    
    return c.json({
      token,
      user: { id: user.id, email: user.email },
      gateway: gatewayResponse(),
    });
  } catch (e) {
    console.error('Login error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /auth/me
app.get('/auth/me', async (c) => {
  const decoded = verifyToken(c.req.header('Authorization'));
  if (!decoded) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const user = await findUserByEmail(decoded.email);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json({
    user: { id: user.id, email: user.email },
    gateway: gatewayResponse(),
  });
});

// GET /auth/google/status - check if Google is connected
app.get('/auth/google/status', async (c) => {
  const decoded = verifyToken(c.req.header('Authorization'));
  if (!decoded) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const tokens = await getGoogleTokens(decoded.userId);
  
  if (!tokens) {
    return c.json({ connected: false, email: null });
  }
  
  return c.json({ 
    connected: true, 
    email: tokens.googleEmail,
  });
});

// GET /auth/google - Start Google OAuth flow
app.get('/auth/google', (c) => {
  const token = c.req.query('token');
  
  if (!GOOGLE_CLIENT_ID) {
    return c.json({ error: 'Google OAuth not configured' }, 500);
  }
  
  // Store the user's JWT in state parameter so we can identify them on callback
  const state = token || '';
  
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent', // Force consent to get refresh token
    state,
  });
  
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback - Handle Google OAuth callback
app.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state'); // User's JWT
  const error = c.req.query('error');
  
  if (error) {
    return c.html(errorPage('Google authorization was denied', error));
  }
  
  if (!code) {
    return c.html(errorPage('Missing authorization code'));
  }
  
  // Verify user from state
  const decoded = state ? verifyToken(`Bearer ${state}`) : null;
  if (!decoded) {
    return c.html(errorPage('Invalid or expired session', 'Please log in again and retry'));
  }
  
  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GOOGLE_REDIRECT_URI,
      }),
    });
    
    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('Google token exchange failed:', errText);
      return c.html(errorPage('Failed to exchange authorization code', errText));
    }
    
    const tokenData = await tokenResponse.json();
    
    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userInfoResponse.ok) {
      return c.html(errorPage('Failed to get Google user info'));
    }
    
    const userInfo = await userInfoResponse.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    
    // Save tokens
    await saveGoogleTokens(
      decoded.userId,
      userInfo.email,
      tokenData.access_token,
      tokenData.refresh_token || '',
      expiresAt
    );
    
    return c.html(successPage(userInfo.email));
  } catch (e) {
    console.error('Google OAuth callback error:', e);
    return c.html(errorPage('An error occurred', String(e)));
  }
});

// POST /auth/google/disconnect - Disconnect Google
app.post('/auth/google/disconnect', async (c) => {
  const decoded = verifyToken(c.req.header('Authorization'));
  if (!decoded) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  await deleteGoogleTokens(decoded.userId);
  return c.json({ success: true, connected: false });
});

// DELETE /auth/google - Alternative disconnect endpoint
app.delete('/auth/google', async (c) => {
  const decoded = verifyToken(c.req.header('Authorization'));
  if (!decoded) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  await deleteGoogleTokens(decoded.userId);
  return c.json({ success: true, connected: false });
});

// GET /auth/google/token - Get a fresh access token for the gateway
app.get('/auth/google/token', async (c) => {
  const decoded = verifyToken(c.req.header('Authorization'));
  if (!decoded) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const accessToken = await refreshGoogleToken(decoded.userId);
  if (!accessToken) {
    return c.json({ error: 'Google not connected or token refresh failed' }, 400);
  }
  
  return c.json({ accessToken });
});

// GET /internal/google/tokens - Gateway fetches user tokens (service-to-service)
// For MVP: returns the first connected user's tokens
// For multi-tenant: would need to pass user ID from session
app.get('/internal/google/tokens', async (c) => {
  // Authenticate with gateway token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.slice(7);
  if (token !== GATEWAY_TOKEN) {
    return c.json({ error: 'Invalid gateway token' }, 401);
  }
  
  // For MVP: get the first user with Google tokens
  // TODO: For multi-tenant, accept userId parameter from gateway session
  if (pool) {
    const result = await pool.query(`
      SELECT user_id, google_email, access_token, refresh_token, expires_at 
      FROM google_tokens 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return c.json({ error: 'No Google tokens found' }, 404);
    }
    
    const row = result.rows[0];
    const expiresAt = new Date(row.expires_at);
    
    // Check if token needs refresh
    if (expiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
      // Token expired or expiring soon, refresh it
      const accessToken = await refreshGoogleToken(row.user_id);
      if (!accessToken) {
        return c.json({ error: 'Failed to refresh token' }, 500);
      }
      
      // Fetch updated tokens
      const updated = await pool.query(
        'SELECT access_token, refresh_token, expires_at FROM google_tokens WHERE user_id = $1',
        [row.user_id]
      );
      
      if (updated.rows.length > 0) {
        const u = updated.rows[0];
        return c.json({
          accessToken: u.access_token,
          refreshToken: u.refresh_token,
          expiresAt: new Date(u.expires_at).toISOString(),
          googleEmail: row.google_email,
        });
      }
    }
    
    return c.json({
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: expiresAt.toISOString(),
      googleEmail: row.google_email,
    });
  }
  
  // In-memory fallback
  const tokens = googleTokensMemory.values().next().value;
  if (!tokens) {
    return c.json({ error: 'No Google tokens found' }, 404);
  }
  
  return c.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt.toISOString(),
    googleEmail: tokens.googleEmail,
  });
});

// GET /gateway/status - returns gateway info for authenticated user
app.get('/gateway/status', async (c) => {
  const decoded = verifyToken(c.req.header('Authorization'));
  if (!decoded) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  return c.json({
    ...gatewayResponse(),
    status: 'running',
  });
});

// Helper functions for HTML pages
function successPage(email: string) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Google Connected - Aware</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
      max-width: 500px; 
      margin: 50px auto; 
      padding: 20px;
      text-align: center;
      background: #1a1a1a;
      color: #fff;
    }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h1 { color: #4285f4; margin-bottom: 10px; }
    p { color: #aaa; line-height: 1.6; }
    .email { color: #fff; font-weight: 500; }
    .success { 
      background: #1e3a2f; 
      border: 1px solid #2d5a45;
      border-radius: 12px; 
      padding: 20px; 
      margin: 20px 0; 
    }
    .close-hint { margin-top: 30px; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="icon">✅</div>
  <h1>Google Connected!</h1>
  <div class="success">
    <p>Successfully connected as <span class="email">${email}</span></p>
    <p>Your Aware assistant now has access to Calendar, Gmail, and Drive.</p>
  </div>
  <p>You can close this window and return to the app.</p>
  <p class="close-hint">The app will update automatically.</p>
</body>
</html>
  `;
}

function errorPage(title: string, detail?: string) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Error - Aware</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
      max-width: 500px; 
      margin: 50px auto; 
      padding: 20px;
      text-align: center;
      background: #1a1a1a;
      color: #fff;
    }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h1 { color: #e74c3c; margin-bottom: 10px; }
    p { color: #aaa; line-height: 1.6; }
    .error { 
      background: #3a1e1e; 
      border: 1px solid #5a2d2d;
      border-radius: 12px; 
      padding: 20px; 
      margin: 20px 0; 
    }
    .detail { font-size: 12px; color: #888; margin-top: 10px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="icon">❌</div>
  <h1>${title}</h1>
  <div class="error">
    <p>Something went wrong connecting your Google account.</p>
    ${detail ? `<p class="detail">${detail}</p>` : ''}
  </div>
  <p>Please close this window and try again.</p>
</body>
</html>
  `;
}

// Start server
async function main() {
  await initDb();
  console.log(`Starting Aware Control Plane on port ${PORT}`);
  console.log(`Google OAuth: ${GOOGLE_CLIENT_ID ? 'configured' : 'NOT configured'}`);
  serve({ fetch: app.fetch, port: PORT });
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});

import 'dotenv/config';
import express from 'express';
import authRoutes from './routes/auth.js';
import gatewayRoutes from './routes/gateway.js';
import googleRoutes from './routes/google.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Routes
app.use('/auth', authRoutes);
app.use('/auth/google', googleRoutes);
app.use('/gateway', gatewayRoutes);

app.listen(PORT, () => {
  console.log(`[api] Listening on port ${PORT}`);
});

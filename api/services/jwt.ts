import { SignJWT, jwtVerify } from 'jose';

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');
  return new TextEncoder().encode(secret);
};

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getSecret());
  if (!payload.sub) throw new Error('Invalid token: missing sub');
  return payload.sub;
}

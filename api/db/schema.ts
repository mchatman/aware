import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_', 21);

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const gateways = pgTable('gateways', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').references(() => users.id).unique().notNull(),
  shortId: text('short_id').unique().notNull(),
  machineId: text('machine_id'),
  token: text('token').notNull(),
  region: text('region').notNull().default('sjc'),
  status: text('status').notNull().default('provisioning'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const googleConnections = pgTable('google_connections', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').references(() => users.id).unique().notNull(),
  email: text('email').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  scopes: text('scopes').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

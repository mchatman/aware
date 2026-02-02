/**
 * Drizzle ORM schema for the Aware API.
 * Defines users, sessions, oauthAccounts, teams, teamMembers,
 * connectors, and gatewayKeys tables.
 * @module
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/** OAuth provider enum (google | microsoft). */
export const oauthProviderEnum = pgEnum("oauth_provider", ["google", "microsoft"]);

/** Core user accounts. */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Refresh-token sessions tied to a user. */
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Linked OAuth accounts (Google / Microsoft) for connector bridging. */
export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: oauthProviderEnum("provider").notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Team role enum                                                     */
/* ------------------------------------------------------------------ */

/** Team member role enum (owner | admin | member). */
export const teamRoleEnum = pgEnum("team_role", ["owner", "admin", "member"]);

/* ------------------------------------------------------------------ */
/*  Teams                                                              */
/* ------------------------------------------------------------------ */

/** Teams — multi-tenant organisational unit. */
export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Team members                                                       */
/* ------------------------------------------------------------------ */

/** Join table linking users to teams with a role. */
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("team_members_team_user_unique").on(t.teamId, t.userId)],
);

/* ------------------------------------------------------------------ */
/*  Connectors                                                         */
/* ------------------------------------------------------------------ */

/** Team-level OAuth connectors (which providers the team uses). */
export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    provider: oauthProviderEnum("provider").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    scopes: text("scopes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("connectors_team_provider_unique").on(t.teamId, t.provider)],
);

/* ------------------------------------------------------------------ */
/*  Gateway keys                                                       */
/* ------------------------------------------------------------------ */

/** API keys used by tenant gateway containers to fetch OAuth tokens. */
export const gatewayKeys = pgTable("gateway_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull(),
  label: varchar("label", { length: 255 }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Subscription status enum                                           */
/* ------------------------------------------------------------------ */

/** Subscription lifecycle status. */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
]);

/* ------------------------------------------------------------------ */
/*  Plan tier enum                                                     */
/* ------------------------------------------------------------------ */

/** Billing plan tier. */
export const planTierEnum = pgEnum("plan_tier", ["free", "pro", "enterprise"]);

/* ------------------------------------------------------------------ */
/*  Subscriptions                                                      */
/* ------------------------------------------------------------------ */

/** Team-level Stripe subscriptions (one per team). */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" })
    .unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", {
    length: 255,
  }).unique(),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  planTier: planTierEnum("plan_tier").notNull().default("free"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", {
    withTimezone: true,
  }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Usage records                                                      */
/* ------------------------------------------------------------------ */

/** Per-period usage tracking for billing metering. */
export const usageRecords = pgTable("usage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  aiTokensUsed: integer("ai_tokens_used").default(0),
  apiCallsCount: integer("api_calls_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Tenant status enum                                                 */
/* ------------------------------------------------------------------ */

/** Tenant container lifecycle status. */
export const tenantStatusEnum = pgEnum("tenant_status", [
  "provisioning",
  "running",
  "stopped",
  "error",
]);

/* ------------------------------------------------------------------ */
/*  Tenants                                                            */
/* ------------------------------------------------------------------ */

/** Tenant containers — one per team, runs an isolated OpenClaw gateway. */
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" })
    .unique(),
  containerId: varchar("container_id", { length: 255 }),
  containerName: varchar("container_name", { length: 255 }).notNull().unique(),
  port: integer("port").notNull().unique(),
  gatewayUrl: text("gateway_url").notNull(),
  status: tenantStatusEnum("status").notNull().default("provisioning"),
  imageTag: varchar("image_tag", { length: 255 }).notNull().default("latest"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  TypeScript helpers                                                 */
/* ------------------------------------------------------------------ */

/** Inferred insert type for `users`. */
export type NewUser = typeof users.$inferInsert;
/** Inferred select type for `users`. */
export type User = typeof users.$inferSelect;

/** Inferred insert type for `sessions`. */
export type NewSession = typeof sessions.$inferInsert;
/** Inferred select type for `sessions`. */
export type Session = typeof sessions.$inferSelect;

/** Inferred insert type for `oauthAccounts`. */
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;
/** Inferred select type for `oauthAccounts`. */
export type OAuthAccount = typeof oauthAccounts.$inferSelect;

/** Inferred insert type for `teams`. */
export type NewTeam = typeof teams.$inferInsert;
/** Inferred select type for `teams`. */
export type Team = typeof teams.$inferSelect;

/** Inferred insert type for `teamMembers`. */
export type NewTeamMember = typeof teamMembers.$inferInsert;
/** Inferred select type for `teamMembers`. */
export type TeamMember = typeof teamMembers.$inferSelect;

/** Inferred insert type for `connectors`. */
export type NewConnector = typeof connectors.$inferInsert;
/** Inferred select type for `connectors`. */
export type Connector = typeof connectors.$inferSelect;

/** Inferred insert type for `gatewayKeys`. */
export type NewGatewayKey = typeof gatewayKeys.$inferInsert;
/** Inferred select type for `gatewayKeys`. */
export type GatewayKey = typeof gatewayKeys.$inferSelect;

/** Inferred insert type for `subscriptions`. */
export type NewSubscription = typeof subscriptions.$inferInsert;
/** Inferred select type for `subscriptions`. */
export type Subscription = typeof subscriptions.$inferSelect;

/** Inferred insert type for `usageRecords`. */
export type NewUsageRecord = typeof usageRecords.$inferInsert;
/** Inferred select type for `usageRecords`. */
export type UsageRecord = typeof usageRecords.$inferSelect;

/** Inferred insert type for `tenants`. */
export type NewTenant = typeof tenants.$inferInsert;
/** Inferred select type for `tenants`. */
export type Tenant = typeof tenants.$inferSelect;

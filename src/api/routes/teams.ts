/**
 * Team management routes for the Aware API.
 * Handles team CRUD, membership management, and role-based access.
 * @module
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { teams, teamMembers, users } from "../db/schema.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const teamsRouter = Router();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Allowed team roles for the role enum. */
type TeamRole = "owner" | "admin" | "member";

/**
 * Generate a URL-safe slug from a team name.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims hyphens.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ */
/*  Middleware: requireTeamRole                                        */
/* ------------------------------------------------------------------ */

/**
 * Express middleware factory that verifies the authenticated user
 * is a member of the team identified by `:teamId` and holds one of
 * the specified roles.
 *
 * Attaches `req.teamMember` with the membership row for downstream use.
 */
export function requireTeamRole(...roles: TeamRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const teamId = req.params.teamId as string;

      if (!teamId) {
        res.status(400).json({ error: "teamId is required", code: "MISSING_TEAM_ID" });
        return;
      }

      const db = getDb();
      const [membership] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, sub)))
        .limit(1);

      if (!membership) {
        res.status(403).json({ error: "Not a member of this team", code: "NOT_TEAM_MEMBER" });
        return;
      }

      if (roles.length > 0 && !roles.includes(membership.role as TeamRole)) {
        res.status(403).json({ error: "Insufficient team role", code: "INSUFFICIENT_ROLE" });
        return;
      }

      // Attach membership for downstream handlers
      (req as AuthenticatedRequest & { teamMember: typeof membership }).teamMember = membership;

      next();
    } catch (err) {
      console.error("requireTeamRole error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

/* ------------------------------------------------------------------ */
/*  POST /api/teams                                                    */
/* ------------------------------------------------------------------ */

teamsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sub } = (req as AuthenticatedRequest).user;
    const { name } = req.body as { name?: string };

    if (!name) {
      res.status(400).json({ error: "name is required", code: "MISSING_FIELDS" });
      return;
    }

    const slug = slugify(name);
    if (!slug) {
      res.status(400).json({ error: "name must produce a valid slug", code: "INVALID_NAME" });
      return;
    }

    const db = getDb();

    // Check for duplicate slug
    const existing = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Team slug already taken", code: "SLUG_EXISTS" });
      return;
    }

    const [team] = await db.insert(teams).values({ name, slug }).returning();

    // Creator becomes owner
    await db.insert(teamMembers).values({
      teamId: team.id,
      userId: sub,
      role: "owner",
    });

    res.status(201).json({ data: { team } });
  } catch (err) {
    console.error("Create team error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/teams                                                     */
/* ------------------------------------------------------------------ */

teamsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sub } = (req as AuthenticatedRequest).user;
    const db = getDb();

    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        role: teamMembers.role,
        createdAt: teams.createdAt,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, sub));

    res.json({ data: { teams: rows } });
  } catch (err) {
    console.error("List teams error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId                                             */
/* ------------------------------------------------------------------ */

teamsRouter.get("/:teamId", requireAuth, requireTeamRole(), async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;
    const db = getDb();

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);

    if (!team) {
      res.status(404).json({ error: "Team not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ data: { team } });
  } catch (err) {
    console.error("Get team error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/teams/:teamId                                           */
/* ------------------------------------------------------------------ */

teamsRouter.patch(
  "/:teamId",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const { name, slug: rawSlug } = req.body as {
        name?: string;
        slug?: string;
      };

      if (!name && !rawSlug) {
        res.status(400).json({ error: "name or slug is required", code: "MISSING_FIELDS" });
        return;
      }

      const db = getDb();
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (name) updates.name = name;

      const newSlug = rawSlug ? slugify(rawSlug) : name ? slugify(name) : undefined;
      if (newSlug) {
        const existing = await db
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.slug, newSlug)))
          .limit(1);

        if (existing.length > 0 && existing[0].id !== teamId) {
          res.status(409).json({ error: "Team slug already taken", code: "SLUG_EXISTS" });
          return;
        }
        updates.slug = newSlug;
      }

      const [team] = await db.update(teams).set(updates).where(eq(teams.id, teamId)).returning();

      res.json({ data: { team } });
    } catch (err) {
      console.error("Update team error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/members                                    */
/* ------------------------------------------------------------------ */

teamsRouter.post(
  "/:teamId/members",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const { email, role } = req.body as { email?: string; role?: string };

      if (!email || !role) {
        res.status(400).json({ error: "email and role are required", code: "MISSING_FIELDS" });
        return;
      }

      const validRoles: TeamRole[] = ["owner", "admin", "member"];
      if (!validRoles.includes(role as TeamRole)) {
        res.status(400).json({ error: "Invalid role", code: "INVALID_ROLE" });
        return;
      }

      const db = getDb();

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
        return;
      }

      // Check if already a member
      const existing = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
        .limit(1);

      if (existing.length > 0) {
        res.status(409).json({ error: "User is already a team member", code: "ALREADY_MEMBER" });
        return;
      }

      const [member] = await db
        .insert(teamMembers)
        .values({ teamId, userId: user.id, role: role as TeamRole })
        .returning();

      res.status(201).json({ data: { member } });
    } catch (err) {
      console.error("Add member error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId/members                                     */
/* ------------------------------------------------------------------ */

teamsRouter.get(
  "/:teamId/members",
  requireAuth,
  requireTeamRole(),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const db = getDb();

      const members = await db
        .select({
          id: teamMembers.id,
          userId: teamMembers.userId,
          role: teamMembers.role,
          joinedAt: teamMembers.joinedAt,
          email: users.email,
          name: users.name,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId));

      res.json({ data: { members } });
    } catch (err) {
      console.error("List members error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  PATCH /api/teams/:teamId/members/:userId                           */
/* ------------------------------------------------------------------ */

teamsRouter.patch(
  "/:teamId/members/:userId",
  requireAuth,
  requireTeamRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const userId = req.params.userId as string;
      const { role } = req.body as { role?: string };

      if (!role) {
        res.status(400).json({ error: "role is required", code: "MISSING_FIELDS" });
        return;
      }

      const validRoles: TeamRole[] = ["owner", "admin", "member"];
      if (!validRoles.includes(role as TeamRole)) {
        res.status(400).json({ error: "Invalid role", code: "INVALID_ROLE" });
        return;
      }

      const db = getDb();

      const [member] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);

      if (!member) {
        res.status(404).json({ error: "Member not found", code: "NOT_FOUND" });
        return;
      }

      const [updated] = await db
        .update(teamMembers)
        .set({ role: role as TeamRole })
        .where(eq(teamMembers.id, member.id))
        .returning();

      res.json({ data: { member: updated } });
    } catch (err) {
      console.error("Update member role error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  DELETE /api/teams/:teamId/members/:userId                          */
/* ------------------------------------------------------------------ */

teamsRouter.delete(
  "/:teamId/members/:userId",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const userId = req.params.userId as string;
      const db = getDb();

      const [member] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);

      if (!member) {
        res.status(404).json({ error: "Member not found", code: "NOT_FOUND" });
        return;
      }

      // Prevent removing the last owner
      if (member.role === "owner") {
        const owners = await db
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "owner")));

        if (owners.length <= 1) {
          res.status(400).json({
            error: "Cannot remove the last owner",
            code: "LAST_OWNER",
          });
          return;
        }
      }

      await db.delete(teamMembers).where(eq(teamMembers.id, member.id));

      res.json({ data: { message: "Member removed" } });
    } catch (err) {
      console.error("Remove member error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

CREATE TYPE "public"."tenant_status" AS ENUM('provisioning', 'running', 'stopped', 'error');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"container_id" varchar(255),
	"container_name" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"gateway_url" text NOT NULL,
	"status" "tenant_status" DEFAULT 'provisioning' NOT NULL,
	"image_tag" varchar(255) DEFAULT 'latest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "tenants_container_name_unique" UNIQUE("container_name"),
	CONSTRAINT "tenants_port_unique" UNIQUE("port")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
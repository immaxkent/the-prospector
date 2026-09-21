ALTER TABLE "companies" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "endeavours" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "scheduled_send_at" timestamp with time zone;
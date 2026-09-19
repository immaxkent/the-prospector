ALTER TABLE "endeavours" ADD COLUMN "from_alias" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;
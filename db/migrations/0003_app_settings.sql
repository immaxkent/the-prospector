CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"monthly_budget_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

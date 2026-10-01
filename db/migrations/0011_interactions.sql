CREATE TABLE "interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interactions_prospect_idx" ON "interactions" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "interactions_endeavour_idx" ON "interactions" USING btree ("endeavour_id");
CREATE TYPE "public"."approval_kind" AS ENUM('outreach_draft', 'reply_approval', 'hot_lead', 'pricing_decision', 'thread_mapping', 'failed_run');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('OBSERVE', 'DRAFT', 'GUARDED', 'DELEGATED');--> statement-breakpoint
CREATE TYPE "public"."endeavour_kind" AS ENUM('sprint', 'ongoing');--> statement-breakpoint
CREATE TYPE "public"."endeavour_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."intake_status" AS ENUM('interviewing', 'ready', 'activated', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('connected', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."message_class" AS ENUM('new_outreach', 'follow_up', 'reply');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."outbound_state" AS ENUM('drafted', 'pending_approval', 'approved', 'rejected', 'queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('discovered', 'researched', 'qualified', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('discovered', 'researching', 'qualified', 'needs_review', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."suppression_kind" AS ENUM('email', 'domain');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"prospect_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"run_date" date NOT NULL,
	"trigger" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"phase" text DEFAULT 'load' NOT NULL,
	"checkpoint" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "endeavour_spec_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"brief" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endeavours" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "endeavour_kind" NOT NULL,
	"status" "endeavour_status" DEFAULT 'draft' NOT NULL,
	"autonomy_level" "autonomy_level" DEFAULT 'DRAFT' NOT NULL,
	"mailbox_id" text,
	"spec" jsonb NOT NULL,
	"spec_version" integer DEFAULT 1 NOT NULL,
	"brief" text NOT NULL,
	"activated_at" timestamp with time zone,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"source_system" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"excerpt" text,
	"claim" text NOT NULL,
	"confidence" double precision NOT NULL,
	"run_id" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"dimension" text NOT NULL,
	"variant_a" text NOT NULL,
	"variant_b" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"type" text NOT NULL,
	"statement" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"brief" text NOT NULL,
	"draft_spec" jsonb,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "intake_status" DEFAULT 'interviewing' NOT NULL,
	"endeavour_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"role" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"display_name" text NOT NULL,
	"provider" text NOT NULL,
	"status" "mailbox_status" DEFAULT 'connected' NOT NULL,
	"limits" jsonb NOT NULL,
	"token_ciphertext" text,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"endeavour_id" text,
	"prospect_id" text,
	"direction" "message_direction" NOT NULL,
	"message_class" "message_class",
	"external_message_id" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"classification" jsonb,
	"template_version" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"send_state" "outbound_state",
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"name" text NOT NULL,
	"proposition" text NOT NULL,
	"pricing" jsonb,
	"cta" text,
	"spec_version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"prospect_id" text,
	"name" text NOT NULL,
	"value" integer NOT NULL,
	"currency" text NOT NULL,
	"stage" "pipeline_stage" NOT NULL,
	"probability_user_defined" double precision,
	"expected_close" date,
	"outcome_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"linkedin_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"company_id" text,
	"person_id" text,
	"segment_id" text,
	"stage" "pipeline_stage" DEFAULT 'discovered' NOT NULL,
	"review_status" "review_status" DEFAULT 'discovered' NOT NULL,
	"qualification_score" integer,
	"score_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_reason" text,
	"rejection_reason" text,
	"source" text NOT NULL,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_log" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"level" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"endeavour_id" text NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"signals" jsonb NOT NULL,
	"pain_hypothesis" text NOT NULL,
	"priority" integer NOT NULL,
	"spec_version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "suppression_kind" NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"endeavour_id" text,
	"prospect_id" text,
	"external_thread_id" text,
	"subject" text NOT NULL,
	"mapping_state" text DEFAULT 'mapped' NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"intent" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"evidence_id" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"google_sub" text,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_runs" ADD CONSTRAINT "daily_runs_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endeavour_spec_versions" ADD CONSTRAINT "endeavour_spec_versions_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endeavours" ADD CONSTRAINT "endeavours_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_daily_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."daily_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_log" ADD CONSTRAINT "run_log_run_id_daily_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."daily_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_endeavour_id_endeavours_id_fk" FOREIGN KEY ("endeavour_id") REFERENCES "public"."endeavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_due_idx" ON "activities" USING btree ("endeavour_id","status","due_at");--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_open_subject_uq" ON "approvals" USING btree ("kind","subject_type","subject_id") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_uq" ON "companies" USING btree ("domain") WHERE "companies"."domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_runs_uq" ON "daily_runs" USING btree ("endeavour_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_versions_uq" ON "endeavour_spec_versions" USING btree ("endeavour_id","version");--> statement-breakpoint
CREATE INDEX "endeavours_status_idx" ON "endeavours" USING btree ("status");--> statement-breakpoint
CREATE INDEX "endeavours_mailbox_idx" ON "endeavours" USING btree ("mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_seq_uq" ON "events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "events_entity_idx" ON "events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "evidence_entity_idx" ON "evidence" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_address_uq" ON "mailboxes" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_uq" ON "messages" USING btree ("external_message_id") WHERE "messages"."external_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_send_state_idx" ON "messages" USING btree ("send_state");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_uq" ON "people" USING btree ("email") WHERE "people"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_endeavour_person_uq" ON "prospects" USING btree ("endeavour_id","person_id");--> statement-breakpoint
CREATE INDEX "prospects_stage_idx" ON "prospects" USING btree ("endeavour_id","stage");--> statement-breakpoint
CREATE INDEX "run_log_run_idx" ON "run_log" USING btree ("run_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_uq" ON "suppressions" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_external_uq" ON "threads" USING btree ("mailbox_id","external_thread_id") WHERE "threads"."external_thread_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub");
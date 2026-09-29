-- When the operator said a prospect is worth writing to. Nothing is drafted until it
-- is set: qualification is the agent's work, deciding who gets an email is not.
ALTER TABLE "prospects" ADD COLUMN "released_at" timestamp with time zone;

-- Every route to a company: generic inboxes, a contact form, Discord, Telegram.
-- Only email is sendable today; the rest are intelligence for the operator.
ALTER TABLE "companies" ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb NOT NULL;

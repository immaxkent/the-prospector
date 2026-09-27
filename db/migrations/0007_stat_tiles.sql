-- Which headline numbers the endeavour page leads with, in the order shown.
-- Empty means the defaults, which is what an install that never opens settings keeps.
ALTER TABLE "app_settings" ADD COLUMN "stat_tiles" jsonb DEFAULT '[]'::jsonb NOT NULL;

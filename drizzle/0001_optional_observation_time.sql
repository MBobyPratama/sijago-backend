-- Observation time is optional; never substitute submission time.
ALTER TABLE report_fact_versions ALTER COLUMN observed_at DROP NOT NULL;

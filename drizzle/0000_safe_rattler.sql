CREATE TYPE "public"."agency_level" AS ENUM('KOTA', 'PROVINSI', 'NASIONAL');--> statement-breakpoint
CREATE TYPE "public"."ai_fallback_reason" AS ENUM('TIMEOUT', 'API_ERROR', 'VALIDATION_FAILED', 'QUOTA_EXCEEDED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."audit_action_type" AS ENUM('AI_GENERATE_SUCCESS', 'AI_FALLBACK_TEMPLATE', 'SOURCE_FACTS_MODIFIED', 'APPROVAL_GRANTED', 'APPROVAL_RESET', 'REPORT_SUBMITTED', 'VERIFY_REPORT', 'REJECT_REPORT', 'ROUTE_ASSIGNED', 'ESCALATION_EMAIL_SENT', 'ESCALATION_EMAIL_FAILED', 'STATUS_CHANGED', 'DUPLICATE_MERGED', 'SIGNOFF_SUBMITTED', 'REOPENED', 'ADMIN_OVERRIDE', 'LOG_EXPORTED', 'CONFIG_UPDATED');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('WARGA_PSEUDONIM', 'ADMIN', 'INSTANSI', 'SISTEM', 'AI');--> statement-breakpoint
CREATE TYPE "public"."damage_category" AS ENUM('LUBANG', 'RETAK', 'AMBLAS', 'BERGELOMBANG', 'GENANGAN_DRAINASE', 'LAINNYA');--> statement-breakpoint
CREATE TYPE "public"."damage_size_class" AS ENUM('KECIL', 'SEDANG', 'BESAR');--> statement-breakpoint
CREATE TYPE "public"."draft_source_type" AS ENUM('AI', 'TEMPLATE');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('GPS', 'MANUAL_PIN');--> statement-breakpoint
CREATE TYPE "public"."photo_kind" AS ENUM('REPORT', 'BEFORE', 'AFTER', 'SIGNOFF');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('DRAFT', 'MENUNGGU_VERIFIKASI', 'TERVERIFIKASI', 'DITOLAK', 'DUPLIKAT', 'DITERUSKAN', 'DIPROSES', 'SELESAI', 'DIBUKA_KEMBALI', 'DITUTUP');--> statement-breakpoint
CREATE TYPE "public"."signoff_rating" AS ENUM('MULUS', 'CEPAT_RUSAK');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'AUDITOR', 'SUPER_ADMIN', 'PETUGAS_INSTANSI');--> statement-breakpoint
CREATE TABLE "admin_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(150) NOT NULL,
	"level" "agency_level" NOT NULL,
	"official_emails" jsonb NOT NULL,
	"jurisdiction_note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "agency_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"new_status" varchar(32) NOT NULL,
	"planned_date" date,
	"note" text,
	"after_photo_ids" jsonb DEFAULT '[]'::jsonb,
	"updated_by_user_id" uuid,
	"is_admin_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bogor_districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"district_name" varchar(100) NOT NULL,
	"subdistrict_name" varchar(100),
	"center_lat" numeric(10, 7) NOT NULL,
	"center_lng" numeric(10, 7) NOT NULL,
	"boundary_polygon" geometry(MultiPolygon, 4326) NOT NULL,
	CONSTRAINT "bogor_districts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"sent_by_user_id" uuid NOT NULL,
	"recipient_emails" jsonb NOT NULL,
	"email_subject" text NOT NULL,
	"email_body_snapshot" text NOT NULL,
	"magic_link_token_hash" varchar(64),
	"provider_message_id" varchar(128),
	"delivery_status" "email_delivery_status" DEFAULT 'QUEUED' NOT NULL,
	"failure_reason" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotspot_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district_name" varchar(100) NOT NULL,
	"center_lat" numeric(10, 7) NOT NULL,
	"center_lng" numeric(10, 7) NOT NULL,
	"radius_meters" integer DEFAULT 250 NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"verified_report_count" integer NOT NULL,
	"avg_rainfall_mm" numeric(8, 2) NOT NULL,
	"recurrence_count" integer DEFAULT 0 NOT NULL,
	"is_red_zone" boolean DEFAULT false NOT NULL,
	"indicative_recommendation" text NOT NULL,
	"rule_version" varchar(32) DEFAULT 'v1.0' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"approved_facts_hash" varchar(64) NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"reset_at" timestamp with time zone,
	"reset_reason" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "report_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_id" uuid,
	"actor_id" varchar(128) NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"action_type" "audit_action_type" NOT NULL,
	"snapshot_before" jsonb,
	"snapshot_after" jsonb,
	"request_id" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"user_agent" text,
	"prev_entry_hash" varchar(64) NOT NULL,
	"entry_hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_condition_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"tag_code" varchar(64) NOT NULL,
	"voter_key" varchar(128) NOT NULL,
	"verified_email_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"facts_version_id" uuid NOT NULL,
	"source_type" "draft_source_type" NOT NULL,
	"title" varchar(80) NOT NULL,
	"body" varchar(600) NOT NULL,
	"model_name" varchar(64),
	"reasoning_effort" varchar(32),
	"prompt_version" varchar(32),
	"fallback_reason" "ai_fallback_reason",
	"validator_result" jsonb,
	"latency_ms" integer,
	"facts_hash" varchar(64) NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_fact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"category" "damage_category" NOT NULL,
	"size_length_cm" numeric(8, 2),
	"size_width_cm" numeric(8, 2),
	"size_depth_cm" numeric(8, 2),
	"size_class" "damage_size_class" NOT NULL,
	"landmark" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"impact_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"free_text" varchar(1000),
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"gps_accuracy_m" numeric(8, 2),
	"photo_ids" jsonb NOT NULL,
	"facts_hash" varchar(64) NOT NULL,
	"created_by_actor" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid,
	"kind" "photo_kind" NOT NULL,
	"cloudinary_public_id" varchar(255) NOT NULL,
	"public_url" text NOT NULL,
	"original_secure_url" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"is_blurred_by_admin" boolean DEFAULT false NOT NULL,
	"exif_taken_at" timestamp with time zone,
	"exif_lat" numeric(10, 7),
	"exif_lng" numeric(10, 7),
	"exif_distance_meters" numeric(10, 2),
	"exif_mismatch_flag" boolean DEFAULT false NOT NULL,
	"uploaded_by_actor" varchar(64) NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_upvotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"voter_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym_id" varchar(64) NOT NULL,
	"device_hash" varchar(128) NOT NULL,
	"contact_email" varchar(255),
	"share_identity_with_agency" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporters_pseudonym_id_unique" UNIQUE("pseudonym_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_code" varchar(24) NOT NULL,
	"tracking_token" varchar(64) NOT NULL,
	"reporter_id" uuid NOT NULL,
	"status" "report_status" DEFAULT 'DRAFT' NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"location_source" "location_source" DEFAULT 'GPS' NOT NULL,
	"district_name" varchar(100),
	"subdistrict_name" varchar(100),
	"suggested_street_name" varchar(255),
	"current_facts_version_id" uuid,
	"current_facts_hash" varchar(64) NOT NULL,
	"approved_draft_id" uuid,
	"assigned_agency_id" uuid,
	"duplicate_of_id" uuid,
	"rejection_reason" varchar(100),
	"rejection_note" text,
	"returned_by_agency" boolean DEFAULT false NOT NULL,
	"return_reason" text,
	"priority_score" numeric(6, 2) DEFAULT '0.00' NOT NULL,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"is_recurrent_hotspot" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"forwarded_at" timestamp with time zone,
	"in_progress_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"monitoring_ends_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"idempotency_key" varchar(128),
	"optimistic_lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_ticket_code_unique" UNIQUE("ticket_code"),
	CONSTRAINT "reports_tracking_token_unique" UNIQUE("tracking_token"),
	CONSTRAINT "reports_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"voter_key" varchar(128) NOT NULL,
	"rating" "signoff_rating" NOT NULL,
	"comment" varchar(500),
	"photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"agency_id" uuid,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weather_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(32) NOT NULL,
	"area_code" varchar(32) NOT NULL,
	"district_name" varchar(100) NOT NULL,
	"observation_date" date NOT NULL,
	"rainfall_mm" numeric(8, 2) NOT NULL,
	"weather_description" varchar(100),
	"has_early_warning" boolean DEFAULT false NOT NULL,
	"early_warning_text" text,
	"is_forecast" boolean DEFAULT false NOT NULL,
	"raw_payload" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_updates" ADD CONSTRAINT "agency_updates_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_updates" ADD CONSTRAINT "agency_updates_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_updates" ADD CONSTRAINT "agency_updates_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_draft_id_report_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."report_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_audit_logs" ADD CONSTRAINT "report_audit_logs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_condition_tags" ADD CONSTRAINT "report_condition_tags_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_drafts" ADD CONSTRAINT "report_drafts_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_drafts" ADD CONSTRAINT "report_drafts_facts_version_id_report_fact_versions_id_fk" FOREIGN KEY ("facts_version_id") REFERENCES "public"."report_fact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fact_versions" ADD CONSTRAINT "report_fact_versions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_photos" ADD CONSTRAINT "report_photos_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_upvotes" ADD CONSTRAINT "report_upvotes_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_reporters_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."reporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_agency_id_agencies_id_fk" FOREIGN KEY ("assigned_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signoffs" ADD CONSTRAINT "signoffs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signoffs" ADD CONSTRAINT "signoffs_photo_id_report_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."report_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_report" ON "report_audit_logs" USING btree ("report_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_tag_voter" ON "report_condition_tags" USING btree ("report_id","tag_code","voter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_fact_version" ON "report_fact_versions" USING btree ("report_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_upvote_voter" ON "report_upvotes" USING btree ("report_id","voter_key");--> statement-breakpoint
CREATE INDEX "idx_reporters_device_hash" ON "reporters" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "idx_reports_status" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reports_agency" ON "reports" USING btree ("assigned_agency_id");--> statement-breakpoint
CREATE INDEX "idx_reports_district" ON "reports" USING btree ("district_name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_signoff_voter" ON "signoffs" USING btree ("report_id","voter_key");
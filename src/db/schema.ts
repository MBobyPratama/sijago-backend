import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  bigserial,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";

// ============================================================================
// 1. CUSTOM POSTGIS GEOMETRY TYPES
// ============================================================================
export const geometryPoint = customType<{
  data: { lng: number; lat: number };
  driverData: string;
}>({
  dataType() {
    return "geometry(Point, 4326)";
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value) {
    return value as unknown as { lng: number; lat: number };
  },
});

export const geometryPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(MultiPolygon, 4326)";
  },
});

// ============================================================================
// 2. ENUMS
// ============================================================================
export const reportStatusEnum = pgEnum("report_status", [
  "DRAFT",
  "MENUNGGU_VERIFIKASI",
  "TERVERIFIKASI",
  "DITOLAK",
  "DUPLIKAT",
  "DITERUSKAN",
  "DIPROSES",
  "SELESAI",
  "DIBUKA_KEMBALI",
  "DITUTUP",
]);

export const damageCategoryEnum = pgEnum("damage_category", [
  "LUBANG",
  "RETAK",
  "AMBLAS",
  "BERGELOMBANG",
  "GENANGAN_DRAINASE",
  "LAINNYA",
]);

export const damageSizeClassEnum = pgEnum("damage_size_class", ["KECIL", "SEDANG", "BESAR"]);
export const locationSourceEnum = pgEnum("location_source", ["GPS", "MANUAL_PIN"]);
export const draftSourceTypeEnum = pgEnum("draft_source_type", ["AI", "TEMPLATE"]);
export const aiFallbackReasonEnum = pgEnum("ai_fallback_reason", [
  "TIMEOUT",
  "API_ERROR",
  "VALIDATION_FAILED",
  "QUOTA_EXCEEDED",
  "DISABLED",
]);
export const photoKindEnum = pgEnum("photo_kind", ["REPORT", "BEFORE", "AFTER", "SIGNOFF"]);
export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "AUDITOR",
  "SUPER_ADMIN",
  "PETUGAS_INSTANSI",
]);
export const agencyLevelEnum = pgEnum("agency_level", ["KOTA", "PROVINSI", "NASIONAL"]);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "FAILED",
]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "WARGA_PSEUDONIM",
  "ADMIN",
  "INSTANSI",
  "SISTEM",
  "AI",
]);
export const auditActionTypeEnum = pgEnum("audit_action_type", [
  "AI_GENERATE_SUCCESS",
  "AI_FALLBACK_TEMPLATE",
  "SOURCE_FACTS_MODIFIED",
  "APPROVAL_GRANTED",
  "APPROVAL_RESET",
  "REPORT_SUBMITTED",
  "VERIFY_REPORT",
  "REJECT_REPORT",
  "ROUTE_ASSIGNED",
  "ESCALATION_EMAIL_SENT",
  "ESCALATION_EMAIL_FAILED",
  "STATUS_CHANGED",
  "DUPLICATE_MERGED",
  "SIGNOFF_SUBMITTED",
  "REOPENED",
  "ADMIN_OVERRIDE",
  "LOG_EXPORTED",
  "CONFIG_UPDATED",
]);
export const signoffRatingEnum = pgEnum("signoff_rating", ["MULUS", "CEPAT_RUSAK"]);

// ============================================================================
// 3. TABEL MASTER & PENGGUNA (REPORTERS, AGENCIES, USERS)
// ============================================================================
export const reporters = pgTable(
  "reporters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pseudonymId: varchar("pseudonym_id", { length: 64 }).notNull().unique(),
    deviceHash: varchar("device_hash", { length: 128 }).notNull(),
    contactEmail: varchar("contact_email", { length: 255 }),
    shareIdentityWithAgency: boolean("share_identity_with_agency").default(false).notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    deviceHashIdx: index("idx_reporters_device_hash").on(table.deviceHash),
  })
);

export const agencies = pgTable("agencies", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  level: agencyLevelEnum("level").notNull(),
  officialEmails: jsonb("official_emails").$type<string[]>().notNull(),
  jurisdictionNote: text("jurisdiction_note"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 150 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull(),
  agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "set null" }),
  mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
  mfaSecret: text("mfa_secret"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 4. TABEL INTI LAPORAN, VERSI FAKTA, FOTO, DRAF AI, & PERSETUJUAN
// ============================================================================
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketCode: varchar("ticket_code", { length: 24 }).notNull().unique(),
    trackingToken: varchar("tracking_token", { length: 64 }).notNull().unique(),
    reporterId: uuid("reporter_id")
      .references(() => reporters.id)
      .notNull(),
    status: reportStatusEnum("status").default("DRAFT").notNull(),

    location: geometryPoint("location").notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    locationSource: locationSourceEnum("location_source").default("GPS").notNull(),
    districtName: varchar("district_name", { length: 100 }),
    subdistrictName: varchar("subdistrict_name", { length: 100 }),
    suggestedStreetName: varchar("suggested_street_name", { length: 255 }),

    currentFactsVersionId: uuid("current_facts_version_id"),
    currentFactsHash: varchar("current_facts_hash", { length: 64 }).notNull(),
    approvedDraftId: uuid("approved_draft_id"),

    assignedAgencyId: uuid("assigned_agency_id").references(() => agencies.id),
    duplicateOfId: uuid("duplicate_of_id"),
    rejectionReason: varchar("rejection_reason", { length: 100 }),
    rejectionNote: text("rejection_note"),
    returnedByAgency: boolean("returned_by_agency").default(false).notNull(),
    returnReason: text("return_reason"),

    priorityScore: numeric("priority_score", { precision: 6, scale: 2 }).default("0.00").notNull(),
    upvoteCount: integer("upvote_count").default(0).notNull(),
    isRecurrentHotspot: boolean("is_recurrent_hotspot").default(false).notNull(),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
    inProgressAt: timestamp("in_progress_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    monitoringEndsAt: timestamp("monitoring_ends_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
    optimisticLockVersion: integer("optimistic_lock_version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("idx_reports_status").on(table.status),
    agencyIdx: index("idx_reports_agency").on(table.assignedAgencyId),
    districtIdx: index("idx_reports_district").on(table.districtName),
  })
);

export const reportFactVersions = pgTable(
  "report_fact_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .references(() => reports.id, { onDelete: "cascade" })
      .notNull(),
    versionNo: integer("version_no").notNull(),

    category: damageCategoryEnum("category").notNull(),
    sizeLengthCm: numeric("size_length_cm", { precision: 8, scale: 2 }),
    sizeWidthCm: numeric("size_width_cm", { precision: 8, scale: 2 }),
    sizeDepthCm: numeric("size_depth_cm", { precision: 8, scale: 2 }),
    sizeClass: damageSizeClassEnum("size_class").notNull(),

    landmark: text("landmark").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    impactTags: jsonb("impact_tags").$type<string[]>().default([]).notNull(),
    freeText: varchar("free_text", { length: 1000 }),

    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    gpsAccuracyM: numeric("gps_accuracy_m", { precision: 8, scale: 2 }),
    photoIds: jsonb("photo_ids").$type<string[]>().notNull(),

    factsHash: varchar("facts_hash", { length: 64 }).notNull(),
    createdByActor: varchar("created_by_actor", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reportVersionUnique: uniqueIndex("uq_report_fact_version").on(table.reportId, table.versionNo),
  })
);

export const reportPhotos = pgTable("report_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  reportId: uuid("report_id").references(() => reports.id, { onDelete: "cascade" }),
  kind: photoKindEnum("kind").notNull(),
  cloudinaryPublicId: varchar("cloudinary_public_id", { length: 255 }).notNull(),
  publicUrl: text("public_url").notNull(),
  originalSecureUrl: text("original_secure_url").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  isBlurredByAdmin: boolean("is_blurred_by_admin").default(false).notNull(),

  exifTakenAt: timestamp("exif_taken_at", { withTimezone: true }),
  exifLat: numeric("exif_lat", { precision: 10, scale: 7 }),
  exifLng: numeric("exif_lng", { precision: 10, scale: 7 }),
  exifDistanceMeters: numeric("exif_distance_meters", { precision: 10, scale: 2 }),
  exifMismatchFlag: boolean("exif_mismatch_flag").default(false).notNull(),

  uploadedByActor: varchar("uploaded_by_actor", { length: 64 }).notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reportDrafts = pgTable("report_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  reportId: uuid("report_id")
    .references(() => reports.id, { onDelete: "cascade" })
    .notNull(),
  factsVersionId: uuid("facts_version_id")
    .references(() => reportFactVersions.id, { onDelete: "cascade" })
    .notNull(),
  sourceType: draftSourceTypeEnum("source_type").notNull(),

  title: varchar("title", { length: 80 }).notNull(),
  body: varchar("body", { length: 600 }).notNull(),

  modelName: varchar("model_name", { length: 64 }),
  reasoningEffort: varchar("reasoning_effort", { length: 32 }),
  promptVersion: varchar("prompt_version", { length: 32 }),
  fallbackReason: aiFallbackReasonEnum("fallback_reason"),
  validatorResult: jsonb("validator_result").$type<{
    passed: boolean;
    checkedNumbers: string[];
    violations: string[];
  }>(),
  latencyMs: integer("latency_ms"),

  factsHash: varchar("facts_hash", { length: 64 }).notNull(),
  isStale: boolean("is_stale").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reportApprovals = pgTable("report_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  reportId: uuid("report_id")
    .references(() => reports.id, { onDelete: "cascade" })
    .notNull(),
  draftId: uuid("draft_id")
    .references(() => reportDrafts.id, { onDelete: "cascade" })
    .notNull(),
  approvedFactsHash: varchar("approved_facts_hash", { length: 64 }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
  isValid: boolean("is_valid").default(true).notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }),
  resetReason: varchar("reset_reason", { length: 64 }),
});

// ============================================================================
// 5. TABEL KOMUNITAS (+1 UPVOTES, TAG KONDISI, & COMMUNITY SIGN-OFF)
// ============================================================================
export const reportUpvotes = pgTable(
  "report_upvotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .references(() => reports.id, { onDelete: "cascade" })
      .notNull(),
    voterKey: varchar("voter_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueUpvote: uniqueIndex("uq_report_upvote_voter").on(table.reportId, table.voterKey),
  })
);

export const reportConditionTags = pgTable(
  "report_condition_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .references(() => reports.id, { onDelete: "cascade" })
      .notNull(),
    tagCode: varchar("tag_code", { length: 64 }).notNull(),
    voterKey: varchar("voter_key", { length: 128 }).notNull(),
    verifiedEmailHash: varchar("verified_email_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueConditionTag: uniqueIndex("uq_report_tag_voter").on(
      table.reportId,
      table.tagCode,
      table.voterKey
    ),
  })
);

export const signoffs = pgTable(
  "signoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .references(() => reports.id, { onDelete: "cascade" })
      .notNull(),
    voterKey: varchar("voter_key", { length: 128 }).notNull(),
    rating: signoffRatingEnum("rating").notNull(),
    comment: varchar("comment", { length: 500 }),
    photoId: uuid("photo_id").references(() => reportPhotos.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSignoff: uniqueIndex("uq_report_signoff_voter").on(table.reportId, table.voterKey),
  })
);

// ============================================================================
// 6. TABEL MODERASI ADMIN, ESKALASI RESEND, & TINDAK LANJUT INSTANSI
// ============================================================================
export const adminNotes = pgTable("admin_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  reportId: uuid("report_id")
    .references(() => reports.id, { onDelete: "cascade" })
    .notNull(),
  authorId: uuid("author_id")
    .references(() => users.id)
    .notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const escalations = pgTable("escalations", {
  id: uuid("id").defaultRandom().primaryKey(),
  reportId: uuid("report_id")
    .references(() => reports.id, { onDelete: "cascade" })
    .notNull(),
  agencyId: uuid("agency_id")
    .references(() => agencies.id)
    .notNull(),
  sentByUserId: uuid("sent_by_user_id")
    .references(() => users.id)
    .notNull(),
  recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull(),
  emailSubject: text("email_subject").notNull(),
  emailBodySnapshot: text("email_body_snapshot").notNull(),
  magicLinkTokenHash: varchar("magic_link_token_hash", { length: 64 }),
  providerMessageId: varchar("provider_message_id", { length: 128 }),
  deliveryStatus: emailDeliveryStatusEnum("delivery_status").default("QUEUED").notNull(),
  failureReason: text("failure_reason"),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agencyUpdates = pgTable("agency_updates", {
  id: uuid("id").defaultRandom().primaryKey(),
  reportId: uuid("report_id")
    .references(() => reports.id, { onDelete: "cascade" })
    .notNull(),
  agencyId: uuid("agency_id")
    .references(() => agencies.id)
    .notNull(),
  newStatus: varchar("new_status", { length: 32 }).notNull(),
  plannedDate: date("planned_date"),
  note: text("note"),
  afterPhotoIds: jsonb("after_photo_ids").$type<string[]>().default([]),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  isAdminOverride: boolean("is_admin_override").default(false).notNull(),
  overrideReason: text("override_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 7. TABEL WEATHER-ROAD INTELLIGENCE (F9) & GEOSPASIAL KOTA BOGOR
// ============================================================================
export const bogorDistricts = pgTable("bogor_districts", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  districtName: varchar("district_name", { length: 100 }).notNull(),
  subdistrictName: varchar("subdistrict_name", { length: 100 }),
  centerLat: numeric("center_lat", { precision: 10, scale: 7 }).notNull(),
  centerLng: numeric("center_lng", { precision: 10, scale: 7 }).notNull(),
  boundaryPolygon: geometryPolygon("boundary_polygon").notNull(),
});

export const weatherObservations = pgTable("weather_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: varchar("source", { length: 32 }).notNull(),
  areaCode: varchar("area_code", { length: 32 }).notNull(),
  districtName: varchar("district_name", { length: 100 }).notNull(),
  observationDate: date("observation_date").notNull(),
  rainfallMm: numeric("rainfall_mm", { precision: 8, scale: 2 }).notNull(),
  weatherDescription: varchar("weather_description", { length: 100 }),
  hasEarlyWarning: boolean("has_early_warning").default(false).notNull(),
  earlyWarningText: text("early_warning_text"),
  isForecast: boolean("is_forecast").default(false).notNull(),
  rawPayload: jsonb("raw_payload"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

export const hotspotZones = pgTable("hotspot_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  districtName: varchar("district_name", { length: 100 }).notNull(),
  centerLat: numeric("center_lat", { precision: 10, scale: 7 }).notNull(),
  centerLng: numeric("center_lng", { precision: 10, scale: 7 }).notNull(),
  radiusMeters: integer("radius_meters").default(250).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  verifiedReportCount: integer("verified_report_count").notNull(),
  avgRainfallMm: numeric("avg_rainfall_mm", { precision: 8, scale: 2 }).notNull(),
  recurrenceCount: integer("recurrence_count").default(0).notNull(),
  isRedZone: boolean("is_red_zone").default(false).notNull(),
  indicativeRecommendation: text("indicative_recommendation").notNull(),
  ruleVersion: varchar("rule_version", { length: 32 }).default("v1.0").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 8. TABEL AUDIT TRAIL (APPEND-ONLY) & KONFIGURASI SISTEM
// ============================================================================
export const reportAuditLogs = pgTable(
  "report_audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    reportId: uuid("report_id").references(() => reports.id, { onDelete: "restrict" }),
    actorId: varchar("actor_id", { length: 128 }).notNull(),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actionType: auditActionTypeEnum("action_type").notNull(),
    snapshotBefore: jsonb("snapshot_before"),
    snapshotAfter: jsonb("snapshot_after"),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    ipHash: varchar("ip_hash", { length: 64 }).notNull(),
    userAgent: text("user_agent"),
    prevEntryHash: varchar("prev_entry_hash", { length: 64 }).notNull(),
    entryHash: varchar("entry_hash", { length: 64 }).notNull(),
  },
  (table) => ({
    reportAuditIdx: index("idx_audit_logs_report").on(table.reportId, table.occurredAt),
  })
);

export const systemConfig = pgTable("system_config", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

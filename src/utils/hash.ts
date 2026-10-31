import crypto from "node:crypto";
import { env } from "../config/env.js";

export interface CanonicalFactInput {
  category: string;
  sizeLengthCm?: number | string | null;
  sizeWidthCm?: number | string | null;
  sizeDepthCm?: number | string | null;
  sizeClass: string;
  landmark: string;
  observedAt: string | null;
  impactTags: string[];
  freeText?: string | null;
  lat: number | string;
  lng: number | string;
  photoIds: string[];
}

/**
 * Menghasilkan SHA-256 `facts_hash` deterministik dari Fakta Asal (FR-3.4, FR-3.5).
 * Perubahan sekecil apa pun pada foto, titik GPS, ukuran, atau teks akan menghasilkan hash berbeda
 * dan otomatis membatalkan persetujuan warga.
 */
export function computeFactsHash(facts: CanonicalFactInput): string {
  const canonicalPayload = JSON.stringify({
    category: facts.category,
    sizeLengthCm: facts.sizeLengthCm != null ? Number(facts.sizeLengthCm) : null,
    sizeWidthCm: facts.sizeWidthCm != null ? Number(facts.sizeWidthCm) : null,
    sizeDepthCm: facts.sizeDepthCm != null ? Number(facts.sizeDepthCm) : null,
    sizeClass: facts.sizeClass,
    landmark: facts.landmark.trim(),
    observedAt: facts.observedAt ? new Date(facts.observedAt).toISOString() : null,
    impactTags: [...facts.impactTags].sort(),
    freeText: (facts.freeText ?? "").trim(),
    lat: Number(facts.lat).toFixed(6),
    lng: Number(facts.lng).toFixed(6),
    photoIds: [...facts.photoIds].sort(),
  });

  return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
}

/**
 * Menghasilkan hash berantai (hash chain) untuk setiap baris `report_audit_logs` (FR-7.5).
 */
export function computeAuditEntryHash(params: {
  prevEntryHash: string;
  occurredAtIso: string;
  reportId?: string | null;
  actorId: string;
  actionType: string;
  snapshotAfter: unknown;
}): string {
  const raw = JSON.stringify({
    prev: params.prevEntryHash,
    at: params.occurredAtIso,
    reportId: params.reportId ?? null,
    actorId: params.actorId,
    actionType: params.actionType,
    after: params.snapshotAfter ?? null,
  });
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Menghasilkan identitas pseudonim untuk perangkat warga atau IP (FR-7.2).
 */
export function hashWithSalt(rawValue: string): string {
  return crypto
    .createHmac("sha256", env.PSEUDONYM_HASH_SALT)
    .update(rawValue)
    .digest("hex")
    .slice(0, 32);
}

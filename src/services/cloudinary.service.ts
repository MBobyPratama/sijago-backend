import { v2 as cloudinary } from "cloudinary";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { reportPhotos } from "../db/schema.js";

if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/**
 * Menghasilkan signature untuk direct signed upload ke Cloudinary dari browser (FR-1.2)
 * serta mendukung pembuatan varian URL publik tanpa EXIF (FR-1.12).
 */
export function generateCloudinaryUploadSignature() {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const folder = env.CLOUDINARY_UPLOAD_FOLDER;

  if (!env.CLOUDINARY_API_SECRET || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_CLOUD_NAME) {
    return {
      configured: false,
      cloudName: env.CLOUDINARY_CLOUD_NAME || "",
      apiKey: env.CLOUDINARY_API_KEY || "",
      timestamp,
      folder,
      signature: "",
    };
  }

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    env.CLOUDINARY_API_SECRET
  );

  return {
    configured: true,
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature,
  };
}

/**
 * Menghasilkan URL publik Cloudinary yang otomatis menghapus metadata EXIF (`fl_strip_profile`)
 * serta optimasi format/kualitas (`f_auto,q_auto`) sesuai FR-1.12.
 */
export function buildStrippedPublicImageUrl(
  cloudinaryPublicId: string,
  fallbackUrl: string,
  applyBlur = false
): string {
  if (!env.CLOUDINARY_CLOUD_NAME || cloudinaryPublicId.startsWith("local_")) {
    return fallbackUrl;
  }

  const transformations: Record<string, unknown>[] = [
    { flags: "strip_profile" },
    { fetch_format: "auto", quality: "auto" },
  ];

  if (applyBlur) {
    transformations.push({ effect: "blur:800" });
  }

  return cloudinary.url(cloudinaryPublicId, {
    secure: true,
    transformation: transformations,
  });
}

/**
 * Menghitung jarak Haversine (meter) antara titik GPS laporan dengan koordinat EXIF foto (FR-5.2, FR-6.5).
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function registerUploadedPhoto(params: {
  reportId?: string | null;
  kind?: "REPORT" | "BEFORE" | "AFTER" | "SIGNOFF";
  cloudinaryPublicId: string;
  originalSecureUrl: string;
  reportLat?: number;
  reportLng?: number;
  exifLat?: number | null;
  exifLng?: number | null;
  exifTakenAt?: string | null;
  uploadedByActor: string;
}) {
  const publicUrl = buildStrippedPublicImageUrl(
    params.cloudinaryPublicId,
    params.originalSecureUrl,
    false
  );

  let exifDistanceMeters: number | null = null;
  let exifMismatchFlag = false;

  if (
    params.reportLat != null &&
    params.reportLng != null &&
    params.exifLat != null &&
    params.exifLng != null
  ) {
    exifDistanceMeters = calculateDistanceMeters(
      params.reportLat,
      params.reportLng,
      params.exifLat,
      params.exifLng
    );
    // Peringatan jika selisih lokasi EXIF foto > 100 meter (FR-6.5 & E-05)
    exifMismatchFlag = exifDistanceMeters > 100;
  }

  const sha256 = crypto
    .createHash("sha256")
    .update(`${params.cloudinaryPublicId}:${params.originalSecureUrl}`)
    .digest("hex");

  const [photo] = await db
    .insert(reportPhotos)
    .values({
      reportId: params.reportId ?? null,
      kind: params.kind ?? "REPORT",
      cloudinaryPublicId: params.cloudinaryPublicId,
      publicUrl,
      originalSecureUrl: params.originalSecureUrl,
      sha256,
      exifTakenAt: params.exifTakenAt ? new Date(params.exifTakenAt) : null,
      exifLat: params.exifLat != null ? String(params.exifLat) : null,
      exifLng: params.exifLng != null ? String(params.exifLng) : null,
      exifDistanceMeters: exifDistanceMeters != null ? exifDistanceMeters.toFixed(2) : null,
      exifMismatchFlag,
      uploadedByActor: params.uploadedByActor,
    })
    .returning();

  return photo;
}

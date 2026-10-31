import { Resend } from "resend";
import { env } from "../config/env.js";
import { hashWithSalt } from "../utils/hash.js";

const resendClient = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// Penyimpanan OTP ringan di memori server untuk keperluan verifikasi Tag Kondisi & Sign-Off (OQ-08)
const otpStore = new Map<string, { code: string; expiresAt: number; verified: boolean }>();

export async function requestEmailOtp(email: string): Promise<{
  email: string;
  sentViaResend: boolean;
}> {
  if (!resendClient) throw new Error("Layanan email belum dikonfigurasi.");
  const cleanEmail = email.trim().toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(cleanEmail, {
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    verified: false,
  });

  let sentViaResend = false;
  if (resendClient) {
    try {
      const res = await resendClient.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to: [cleanEmail],
        subject: `[SIJAGO Kota Bogor] Kode OTP Verifikasi Komunitas: ${code}`,
        html: `
          <div style="font-family: sans-serif; max-width: 520px; color: #0f172a;">
            <h2 style="color: #1e40af;">Verifikasi Partisipasi Komunitas SIJAGO</h2>
            <p>Gunakan kode OTP 6 digit berikut untuk menambahkan Tag Kondisi atau memberikan penilaian Community Sign-Off:</p>
            <div style="font-size: 28px; font-weight: 800; letter-spacing: 6px; padding: 12px 16px; background: #f1f5f9; border-radius: 8px; display: inline-block;">
              ${code}
            </div>
            <p style="font-size: 12px; color: #64748b; margin-top: 16px;">
              Kode berlaku selama 10 menit. Abaikan email ini jika Anda tidak meminta verifikasi di SIJAGO.
            </p>
          </div>
        `,
      });
      if (!res.error) {
        sentViaResend = true;
      }
    } catch {
      sentViaResend = false;
    }
  }

  if (!sentViaResend) { otpStore.delete(cleanEmail); throw new Error("Kode verifikasi belum berhasil dikirim."); }
  return {
    email: cleanEmail,
    sentViaResend,
  };
}

export function verifyEmailOtp(email: string, code: string): {
  valid: boolean;
  verifiedEmailHash: string;
} {
  const cleanEmail = email.trim().toLowerCase();
  const record = otpStore.get(cleanEmail);

  const isMatch = record && record.code === code.trim() && Date.now() < record.expiresAt;

  if (!isMatch) {
    return { valid: false, verifiedEmailHash: "" };
  }

  if (record) {
    record.verified = true;
  }

  return {
    valid: true,
    verifiedEmailHash: hashWithSalt(cleanEmail),
  };
}

export interface SendEscalationEmailInput {
  ticketCode: string;
  agencyName: string;
  recipientEmails: string[];
  permanentLabel: string;
  title: string;
  body: string;
  districtName: string;
  landmark: string;
  lat: string | number;
  lng: string | number;
  adminNote?: string;
}

/**
 * Mengirim email eskalasi resmi ke instansi melalui Resend (FR-5.6, FR-5.7, FR-5.8).
 * Hanya boleh dipanggil dari aksi eksplisit Admin (BRL-06).
 */
export async function sendOfficialEscalationEmail(input: SendEscalationEmailInput): Promise<{
  success: boolean;
  providerMessageId: string | null;
  deliveryStatus: "SENT" | "FAILED";
  failureReason: string | null;
  subject: string;
  bodySnapshot: string;
  sentTo: string[];
}> {
  const targetEmails = input.recipientEmails;

  const subject = `[ESKALASI RESMI SIJAGO ${input.ticketCode}] ${input.title}`;
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${input.lat}&mlon=${input.lng}#map=17/${input.lat}/${input.lng}`;
  const portalUrl = `${env.FRONTEND_URL}/instansi/laporan?tiket=${input.ticketCode}`;

  const bodySnapshot = [
    `Yth. ${input.agencyName},`,
    ``,
    `Bersama email ini, Admin Moderator SIJAGO (Sistem Jalan Bogor) meneruskan laporan kerusakan jalan yang telah diverifikasi:`,
    `- Kode Tiket: ${input.ticketCode}`,
    `- Judul: ${input.title}`,
    `- Deskripsi: ${input.body}`,
    `- Lokasi: ${input.districtName} (${input.landmark})`,
    `- Koordinat GPS: ${input.lat}, ${input.lng} (${mapsUrl})`,
    input.adminNote ? `- Catatan Verifikasi Admin: ${input.adminNote}` : ``,
    `- Privasi Pelapor: Identitas pelapor tidak disertakan sesuai aturan pelindungan data (BRL-14).`,
    ``,
    `Tindak Lanjut & Unggah Bukti Perbaikan melalui Portal Instansi SIJAGO: ${portalUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!resendClient || targetEmails.length === 0) {
    return {
      success: false,
      providerMessageId: null,
      deliveryStatus: "FAILED",
      failureReason: "Layanan email atau alamat instansi belum dikonfigurasi.",
      subject,
      bodySnapshot,
      sentTo: targetEmails,
    };
  }

  try {
    const result = await resendClient.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: targetEmails,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 620px; color: #0f172a; line-height: 1.6;">
          <div style="background: #1e40af; color: #ffffff; padding: 14px 20px; border-radius: 10px 10px 0 0;">
            <strong>SIJAGO (Sistem Jalan Bogor) — Eskalasi Resmi Laporan Terverifikasi</strong>
          </div>
          <div style="border: 1px solid #cbd5e1; border-top: none; padding: 20px; border-radius: 0 0 10px 10px;">
            <p>Yth. <strong>${input.agencyName}</strong>,</p>
            <p>Laporan kerusakan jalan berikut telah diverifikasi oleh Admin SIJAGO dan diteruskan sesuai kewenangan ruas jalan:</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin: 12px 0;">
              <div><strong>Kode Tiket:</strong> ${input.ticketCode}</div>

              <div style="margin-top: 8px; font-weight: 700; font-size: 15px;">${input.title}</div>
              <p style="margin: 6px 0;">${input.body}</p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 10px 0;" />
              <div style="font-size: 13px;">
                <strong>Kecamatan / Patokan:</strong> ${input.districtName} — ${input.landmark}<br/>
                <strong>Koordinat GPS:</strong> ${input.lat}, ${input.lng} (<a href="${mapsUrl}">Buka di OpenStreetMap</a>)<br/>
                ${input.adminNote ? `<strong>Catatan Admin:</strong> ${input.adminNote}<br/>` : ""}
                <strong>Privasi Pelapor:</strong> Disembunyikan sesuai aturan BRL-14.
              </div>
            </div>
            <p>
              <a href="${portalUrl}" style="display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 700; padding: 10px 16px; border-radius: 8px;">
                Buka Portal Instansi &amp; Perbarui Status Perbaikan →
              </a>
            </p>
          </div>
        </div>
      `,
    });

    if (result.error) {
      // Jika sandbox Resend menolak alamat yang belum diverifikasi, tetap kembalikan informasi rõ
      return {
        success: false,
        providerMessageId: null,
        deliveryStatus: "FAILED",
        failureReason: result.error.message,
        subject,
        bodySnapshot,
        sentTo: targetEmails,
      };
    }

    return {
      success: true,
      providerMessageId: result.data?.id ?? `re_${Date.now()}`,
      deliveryStatus: "SENT",
      failureReason: null,
      subject,
      bodySnapshot,
      sentTo: targetEmails,
    };
  } catch (err) {
    return {
      success: false,
      providerMessageId: null,
      deliveryStatus: "FAILED",
      failureReason: err instanceof Error ? err.message : "Resend error",
      subject,
      bodySnapshot,
      sentTo: targetEmails,
    };
  }
}

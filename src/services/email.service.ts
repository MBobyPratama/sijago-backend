import { Resend } from "resend";
import { env } from "../config/env.js";
import { hashWithSalt } from "../utils/hash.js";

const resendClient = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

export function buildTicketReceiptEmail(ticketCode: string) {
  const url = new URL("/lacak", env.FRONTEND_URL);
  url.searchParams.set("kode", ticketCode);
  const logoUrl = new URL("/images/logo_header_email.png", env.FRONTEND_URL);
  const safeTicket = escapeEmailHtml(ticketCode);
  const safeUrl = escapeEmailHtml(url.href);
  return {
    subject: `[SIJAGO] Tiket laporan ${ticketCode}`,
    text: `Laporan Anda sudah diterima SIJAGO dan masuk ke antrean verifikasi admin.\n\nKode tiket: ${ticketCode}\nLacak laporan: ${url.href}\n\nSimpan email ini untuk menemukan laporan Anda kembali. Jadwal perbaikan menjadi kewenangan instansi terkait.`,
    html: `<!doctype html><html lang="id"><body style="margin:0;padding:24px 12px;background:#f5f7fa;font-family:Arial,sans-serif;color:#172c43;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #d6dfe8;border-radius:16px;"><tr><td style="padding:32px;">
          <img src="${escapeEmailHtml(logoUrl.href)}" alt="SIJAGO — Sistem Jalan Bogor" width="190" height="66" style="display:block;max-width:100%;height:auto;border:0;margin-bottom:28px;" />
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.35;">Laporan Anda sudah terkirim</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#52667b;">Laporan masuk ke antrean verifikasi admin. Simpan kode tiket berikut untuk memantau perkembangannya.</p>
          <p style="margin:0;font-size:14px;color:#52667b;">Kode tiket Anda</p>
          <p style="margin:8px 0 24px;font-size:28px;font-weight:bold;line-height:1.4;overflow-wrap:anywhere;color:#1e40af;">${safeTicket}</p>
          <a href="${safeUrl}" style="display:inline-block;padding:14px 22px;background:#1e40af;color:#ffffff;border-radius:8px;font-size:16px;font-weight:bold;text-decoration:none;">Lacak laporan</a>
          <p style="margin:24px 0 8px;font-size:14px;line-height:1.7;color:#52667b;">Jika tombol tidak dapat dibuka, gunakan tautan berikut:</p>
          <p style="margin:0;font-size:14px;line-height:1.7;overflow-wrap:anywhere;"><a href="${safeUrl}" style="color:#1e40af;">${safeUrl}</a></p>
          <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #d6dfe8;font-size:12px;line-height:1.7;color:#52667b;">Simpan email ini untuk menemukan laporan Anda kembali. Jadwal perbaikan menjadi kewenangan instansi terkait.</p>
        </td></tr></table>
      </td></tr></table>
    </body></html>`,
  };
}

export async function sendTicketReceiptEmail(input: { reportId: string; ticketCode: string; email: string }): Promise<"SENT" | "FAILED"> {
  if (!resendClient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return "FAILED";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resendClient.emails.send({ from: env.RESEND_FROM_EMAIL, to: [input.email], ...buildTicketReceiptEmail(input.ticketCode) }, { idempotencyKey: `ticket-receipt/${input.reportId}` }),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("RECEIPT_TIMEOUT")), 8000); }),
    ]);
    return !result.error && result.data?.id ? "SENT" : "FAILED";
  } catch { return "FAILED"; }
  finally { if (timeout) clearTimeout(timeout); }
}

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

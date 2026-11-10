import { Resend } from "resend";
import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { descriptionToText, type ReportDescriptionData } from "../utils/reportDescription.js";

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

export async function sendCommunityOtpCode(email: string, code: string): Promise<boolean> {
  if (!resendClient) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resendClient.emails.send({ from: env.RESEND_FROM_EMAIL, to: [email], subject: "[SIJAGO] Kode verifikasi partisipasi warga", text: `Kode verifikasi SIJAGO Anda: ${code}. Berlaku 10 menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini kepada siapa pun. Abaikan jika Anda tidak meminta kode.`, html: `<div style="font-family:Arial,sans-serif;max-width:520px;line-height:1.7;color:#172c43"><h2>Verifikasi email SIJAGO</h2><p>Gunakan kode berikut untuk menambahkan tag atau penilaian pada laporan yang Anda buka.</p><p style="font-size:28px;font-weight:bold;color:#1e40af">${code}</p><p>Kode berlaku 10 menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini. Abaikan email ini jika Anda tidak meminta kode.</p></div>` }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("OTP_SEND_TIMEOUT")), 8000); }),
    ]);
    return !result.error && Boolean(result.data?.id);
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}

export interface SendEscalationEmailInput {
  ticketCode: string;
  agencyName: string;
  recipientEmails: string[];
  permanentLabel: string;
  title: string;
  body: string;
  description?: ReportDescriptionData;
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
export function buildOfficialEscalationMessage(input: SendEscalationEmailInput) {
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
    input.description ? `Deskripsi laporan:\n${descriptionToText(input.description)}` : `- Deskripsi: ${input.body}`,
    `- Lokasi: ${input.districtName} (${input.landmark})`,
    `- Koordinat GPS: ${input.lat}, ${input.lng} (${mapsUrl})`,
    input.adminNote ? `- Catatan Verifikasi Admin: ${input.adminNote}` : ``,
    `- Privasi Pelapor: Identitas pelapor tidak disertakan sesuai aturan pelindungan data (BRL-14).`,
    ``,
    `Tindak Lanjut & Unggah Bukti Perbaikan melalui Portal Instansi SIJAGO: ${portalUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, bodySnapshot, sentTo: targetEmails };
}

export async function sendStoredEscalationEmail(input: { subject: string; bodySnapshot: string; sentTo: string[]; escalationId: string }) {
  if (!resendClient || input.sentTo.length === 0) return { success: false, providerMessageId: null, failureReason: "Layanan email atau alamat instansi belum dikonfigurasi." };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resendClient.emails.send({ from: env.RESEND_FROM_EMAIL, to: input.sentTo, subject: input.subject, text: input.bodySnapshot,
        html: '<div style="font-family:sans-serif;max-width:620px;color:#172c43;line-height:1.7"><h2 style="color:#1e40af">Eskalasi resmi SIJAGO</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + escapeEmailHtml(input.bodySnapshot) + '</div></div>' }, { idempotencyKey: 'escalation/' + input.escalationId + '/' + createHash("sha256").update(JSON.stringify([input.subject, input.bodySnapshot, input.sentTo])).digest("hex").slice(0, 24) }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Pengiriman email melewati batas waktu.")), 8000); }),
    ]);
    if (result.error || !result.data?.id) return { success: false, providerMessageId: null, failureReason: result.error?.message || "Penyedia email belum mengonfirmasi pengiriman." };
    return { success: true, providerMessageId: result.data.id, failureReason: null };
  } catch (err) { return { success: false, providerMessageId: null, failureReason: err instanceof Error ? err.message : "Email belum terkirim." }; }
  finally { if (timer) clearTimeout(timer); }
}

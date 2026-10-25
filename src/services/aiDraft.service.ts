import OpenAI from "openai";
import { env } from "../config/env.js";
import { CanonicalFactInput } from "../utils/hash.js";

/**
 * PENTING (FR-2.8 & BRL-05):
 * Modul AI ini DILARANG KERAS mengimpor layanan email (Resend) atau mengubah status laporan.
 * Hanya bertugas menghasilkan teks draf dari Fakta Asal non-PII, memvalidasinya secara deterministik,
 * atau menjatuhkan ke Draf Template bila gagal.
 */

export interface DraftGenerationOutput {
  sourceType: "AI" | "TEMPLATE";
  permanentLabel: "✨ [Draf Dibantu AI]" | "📄 [Draf Template]";
  title: string;
  body: string;
  modelName: string | null;
  reasoningEffort: string | null;
  promptVersion: string;
  fallbackReason:
    | "TIMEOUT"
    | "API_ERROR"
    | "VALIDATION_FAILED"
    | "QUOTA_EXCEEDED"
    | "DISABLED"
    | null;
  fallbackNotice: string | null;
  validatorResult: {
    passed: boolean;
    checkedNumbers: string[];
    violations: string[];
  };
  latencyMs: number;
}

const PROMPT_VERSION = "v1.0-mia2026";

const FORBIDDEN_PATTERNS = [
  /dinas\s+pupr/i,
  /pemkot/i,
  /pemprov/i,
  /kementerian\s+pu/i,
  /balai\s+besar/i,
  /korupsi/i,
  /lalai/i,
  /pejabat\s+tidak\s+becus/i,
];

/**
 * Menghasilkan Draf Template deterministik tanpa model bahasa (FR-2.6).
 */
export function buildDeterministicTemplateDraft(facts: CanonicalFactInput): {
  title: string;
  body: string;
} {
  const categoryLabel = facts.category.replace(/_/g, " ");
  const shortLandmark =
    facts.landmark.length > 42 ? `${facts.landmark.slice(0, 39)}...` : facts.landmark;

  const title = `[${categoryLabel} - ${facts.sizeClass}] Kerusakan Jalan di ${shortLandmark}`.slice(
    0,
    80
  );

  const dims: string[] = [];
  if (facts.sizeLengthCm) dims.push(`panjang ${facts.sizeLengthCm} cm`);
  if (facts.sizeWidthCm) dims.push(`lebar ${facts.sizeWidthCm} cm`);
  if (facts.sizeDepthCm) dims.push(`kedalaman ${facts.sizeDepthCm} cm`);
  const dimText = dims.length > 0 ? ` (${dims.join(", ")})` : "";

  const impacts =
    facts.impactTags.length > 0
      ? facts.impactTags.map((t) => t.replace(/_/g, " ").toLowerCase()).join(", ")
      : "mengganggu kenyamanan pengguna jalan";

  const notePart = facts.freeText ? ` Catatan lapangan: ${facts.freeText.trim()}` : "";

  const body =
    `Dilaporkan kerusakan jalan kategori ${categoryLabel.toLowerCase()} dengan kelas ukuran ${facts.sizeClass.toLowerCase()}${dimText}. Patokan lokasi berada di ${facts.landmark.trim()}. Kondisi ini berdampak pada ${impacts}.${notePart}`.slice(
      0,
      600
    );

  return { title, body };
}

/**
 * Validator Pascagenerasi Deterministik (FR-2.4):
 * Memastikan tidak ada angka baru yang dikarang AI, tidak menyebut nama instansi/tuduhan,
 * dan panjang sesuai batas.
 */
export function validateAiDraftOutput(
  facts: CanonicalFactInput,
  draft: { title: string; body: string }
): { passed: boolean; checkedNumbers: string[]; violations: string[] } {
  const violations: string[] = [];

  if (!draft.title || draft.title.trim().length === 0 || draft.title.length > 80) {
    violations.push("TITLE_LENGTH_INVALID");
  }
  if (!draft.body || draft.body.trim().length === 0 || draft.body.length > 600) {
    violations.push("BODY_LENGTH_INVALID");
  }

  const combinedText = `${draft.title} ${draft.body}`;
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(combinedText)) {
      violations.push(`FORBIDDEN_TERM_MATCHED:${pattern.source}`);
    }
  }

  // Pastikan setiap angka di output AI memang berasal dari input Fakta Asal
  const allowedSourceText = [
    facts.sizeLengthCm ?? "",
    facts.sizeWidthCm ?? "",
    facts.sizeDepthCm ?? "",
    facts.landmark,
    facts.freeText ?? "",
    facts.observedAt,
  ].join(" ");

  const inputNumbers = new Set(allowedSourceText.match(/\d+(?:[.,]\d+)?/g) ?? []);
  const outputNumbers = combinedText.match(/\d+(?:[.,]\d+)?/g) ?? [];

  for (const num of outputNumbers) {
    if (!inputNumbers.has(num)) {
      violations.push(`HALLUCINATED_NUMBER:${num}`);
    }
  }

  return {
    passed: violations.length === 0,
    checkedNumbers: outputNumbers,
    violations,
  };
}

/**
 * Fungsi utama pembuatan draf laporan menggunakan OpenAI `gpt-6-luna` (reasoning: medium)
 * dengan fallback otomatis ke Draf Template.
 */
export async function generateReportDraft(
  facts: CanonicalFactInput
): Promise<DraftGenerationOutput> {
  const startTime = Date.now();

  if (!env.AI_DRAFT_ENABLED || !env.OPENAI_API_KEY) {
    const tpl = buildDeterministicTemplateDraft(facts);
    return {
      sourceType: "TEMPLATE",
      permanentLabel: "📄 [Draf Template]",
      title: tpl.title,
      body: tpl.body,
      modelName: null,
      reasoningEffort: null,
      promptVersion: PROMPT_VERSION,
      fallbackReason: "DISABLED",
      fallbackNotice:
        "Menggunakan Draf Template baku karena asisten AI sedang dinonaktifkan atau kunci API belum diisi.",
      validatorResult: { passed: true, checkedNumbers: [], violations: [] },
      latencyMs: Date.now() - startTime,
    };
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

  try {
    const systemPrompt = [
      "Anda adalah asisten perapi teks laporan kerusakan jalan untuk platform SIJAGO Kota Bogor.",
      "ATURAN KERAS:",
      "1. Hanya rangkum fakta yang diberikan di dalam JSON input menjadi Bahasa Indonesia baku, lugas, dan netral.",
      "2. DILARANG menambah fakta baru, mengubah angka/ukuran, menyebut nama instansi (seperti Dinas PUPR/Pemkot), menuduh pihak mana pun, atau menyatakan status penanganan.",
      "3. Kembalikan HANYA format JSON valid dengan key: {\"title\": \"maks 80 karakter\", \"body\": \"maks 600 karakter\"}.",
    ].join("\n");

    const response = await client.chat.completions.create(
      {
        model: env.OPENAI_MODEL,
        reasoning_effort: env.OPENAI_REASONING_EFFORT,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              kategori: facts.category,
              kelasUkuran: facts.sizeClass,
              panjangCm: facts.sizeLengthCm ?? null,
              lebarCm: facts.sizeWidthCm ?? null,
              kedalamanCm: facts.sizeDepthCm ?? null,
              patokanLokasi: facts.landmark,
              dampak: facts.impactTags,
              uraianWarga: facts.freeText ?? "",
            }),
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);
    const rawContent = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(rawContent) as { title?: string; body?: string };

    const candidate = {
      title: (parsed.title ?? "").trim(),
      body: (parsed.body ?? "").trim(),
    };

    const validation = validateAiDraftOutput(facts, candidate);
    if (!validation.passed) {
      const tpl = buildDeterministicTemplateDraft(facts);
      return {
        sourceType: "TEMPLATE",
        permanentLabel: "📄 [Draf Template]",
        title: tpl.title,
        body: tpl.body,
        modelName: env.OPENAI_MODEL,
        reasoningEffort: env.OPENAI_REASONING_EFFORT,
        promptVersion: PROMPT_VERSION,
        fallbackReason: "VALIDATION_FAILED",
        fallbackNotice:
          "Hasil ringkasan AI tidak lolos pemeriksaan kemurnian fakta. Sistem otomatis beralih ke Draf Template baku.",
        validatorResult: validation,
        latencyMs: Date.now() - startTime,
      };
    }

    return {
      sourceType: "AI",
      permanentLabel: "✨ [Draf Dibantu AI]",
      title: candidate.title,
      body: candidate.body,
      modelName: env.OPENAI_MODEL,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
      promptVersion: PROMPT_VERSION,
      fallbackReason: null,
      fallbackNotice: null,
      validatorResult: validation,
      latencyMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const tpl = buildDeterministicTemplateDraft(facts);

    return {
      sourceType: "TEMPLATE",
      permanentLabel: "📄 [Draf Template]",
      title: tpl.title,
      body: tpl.body,
      modelName: env.OPENAI_MODEL,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
      promptVersion: PROMPT_VERSION,
      fallbackReason: isAbort ? "TIMEOUT" : "API_ERROR",
      fallbackNotice:
        "Layanan perapi teks AI sedang sibuk. Sistem otomatis menyusun draf menggunakan format baku agar Anda dapat langsung melanjutkan.",
      validatorResult: { passed: true, checkedNumbers: [], violations: [] },
      latencyMs: Date.now() - startTime,
    };
  }
}

export const CONDITION_TAG_LABELS: Record<string, string> = {
  MAKIN_DALAM: "Makin dalam",
  RAWAN_MALAM: "Rawan kecelakaan malam",
  TERTUTUP_AIR: "Tertutup genangan air",
  SERING_CELAKA: "Sering buat jatuh",
  TERTUTUP_GENANGAN_AIR: "Tertutup genangan air",
  RAWAN_PEMOTOR_JATUH: "Rawan pemotor jatuh",
  MINIM_PENERANGAN: "Minim penerangan malam",
};
export const presentConditionTags = (rows: { tagCode: string; count: number }[]) => rows.map(row => ({ code: row.tagCode, label: CONDITION_TAG_LABELS[row.tagCode] || row.tagCode.replaceAll("_", " ").toLowerCase(), count: Number(row.count) }));

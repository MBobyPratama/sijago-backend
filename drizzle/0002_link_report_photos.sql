-- Recover evidence uploaded before its report existed. Ambiguous references are left untouched.
WITH references_by_photo AS (
  SELECT p.id, (array_agg(DISTINCT f.report_id))[1] AS report_id
  FROM report_photos p
  JOIN report_fact_versions f ON f.photo_ids ? p.id::text
  JOIN reports r ON r.id = f.report_id
  WHERE p.report_id IS NULL AND p.kind IN ('REPORT', 'BEFORE')
  GROUP BY p.id
  HAVING count(DISTINCT f.report_id) = 1
)
UPDATE report_photos p
SET report_id = refs.report_id
FROM references_by_photo refs
WHERE p.id = refs.id AND p.report_id IS NULL;

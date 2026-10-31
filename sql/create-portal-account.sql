-- SIJAGO / Neon SQL Editor
-- Run section 1 once. Run section 2 once PER ACCOUNT after replacing its variables.
-- No account or default password is created until you replace the placeholders.

-- 1. Session storage and password-hashing extension (idempotent).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  credential_fingerprint varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON public.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON public.auth_sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON public.users(lower(email));

-- 2. Replace these values, then run the DO block.
-- ADMIN / SUPER_ADMIN / AUDITOR: leave v_agency_code NULL.
-- PETUGAS_INSTANSI: set v_role and choose the matching agency code from section 3.
-- Use a DIFFERENT strong password for each account. Passwords are stored as bcrypt hashes.
DO $create_account$
DECLARE
  v_email text := 'GANTI_EMAIL_AKUN';
  v_full_name text := 'GANTI_NAMA_LENGKAP';
  v_password text := $password$GANTI_DENGAN_KATA_SANDI_UNIK_MINIMAL_12_KARAKTER$password$;
  v_role public.user_role := 'ADMIN';
  v_agency_code text := NULL; -- Example agency code: PUPR_KOTA_BOGOR
  v_agency_id uuid;
  v_user_id uuid;
BEGIN
  v_email := lower(trim(v_email));
  IF v_email LIKE '%ganti%' OR v_full_name LIKE 'GANTI_%' OR v_password LIKE 'GANTI_%'
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(trim(v_full_name)) < 2 THEN
    RAISE EXCEPTION 'Ganti email, nama lengkap, dan kata sandi sebelum menjalankan query.';
  END IF;
  IF length(v_password) < 12 OR octet_length(v_password) > 72 THEN
    RAISE EXCEPTION 'Kata sandi minimal 12 karakter dan maksimal 72 byte UTF-8.';
  END IF;
  IF v_role = 'PETUGAS_INSTANSI' THEN
    SELECT id INTO v_agency_id FROM public.agencies WHERE code = v_agency_code;
    IF v_agency_id IS NULL THEN RAISE EXCEPTION 'Kode instansi tidak ditemukan.'; END IF;
    -- Activate the selected agency for account access, without inventing official email contacts.
    UPDATE public.agencies SET is_active = true WHERE id = v_agency_id;
  ELSIF v_agency_code IS NOT NULL THEN
    RAISE EXCEPTION 'Akun admin/auditor tidak perlu kode instansi; gunakan NULL.';
  END IF;
  INSERT INTO public.users(email, full_name, password_hash, role, agency_id, is_active, mfa_enabled)
  VALUES(v_email, trim(v_full_name), crypt(v_password, gen_salt('bf', 12)), v_role, v_agency_id, true, false)
  RETURNING id INTO v_user_id;
  -- Duplicate email intentionally fails; rerunning this block never silently resets a password.
  RAISE NOTICE 'Akun dibuat: % / role % / id %', v_email, v_role, v_user_id;
END
$create_account$;

-- 3. Reference codes for agency accounts. This query does not expose password hashes.
SELECT code, name, is_active FROM public.agencies ORDER BY name;
SELECT u.email, u.full_name, u.role, a.code AS agency_code, u.is_active
FROM public.users u LEFT JOIN public.agencies a ON a.id = u.agency_id ORDER BY u.email;

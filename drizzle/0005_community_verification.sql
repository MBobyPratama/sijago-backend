CREATE TABLE IF NOT EXISTS public.community_otp_challenges (
  id uuid PRIMARY KEY,
  email_hash varchar(64) NOT NULL UNIQUE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  device_hash varchar(64) NOT NULL,
  code_hash varchar(64) NOT NULL,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  delivered_at timestamptz,
  consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.community_verification_tokens (
  token_hash varchar(64) PRIMARY KEY,
  email_hash varchar(64) NOT NULL,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  device_hash varchar(64) NOT NULL,
  purpose varchar(40) NOT NULL DEFAULT 'PUBLIC_COMMUNITY_ACTION',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_community_tokens_expiry ON public.community_verification_tokens(expires_at);

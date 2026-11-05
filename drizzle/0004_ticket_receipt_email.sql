ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS receipt_email_to varchar(255);
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS receipt_email_status varchar(20);

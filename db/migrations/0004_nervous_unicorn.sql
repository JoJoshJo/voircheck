-- Short public-safe order reference per payment (VC-7K2F), made by Postgres so every insert gets one.
-- Alphabet: no 0/O or 1/I (easy to read out). Unique; the function retries on a clash.
ALTER TABLE "payments" ADD COLUMN "ref" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION vc_payment_ref() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
BEGIN
  LOOP
    candidate := 'VC-';
    FOR i IN 1..4 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM payments WHERE ref = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM payments WHERE ref IS NULL LOOP
    UPDATE payments SET ref = vc_payment_ref() WHERE id = r.id;
  END LOOP;
END;
$$;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "ref" SET DEFAULT vc_payment_ref();--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ref_unique" UNIQUE("ref");

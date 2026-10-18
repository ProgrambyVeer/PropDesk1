DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "email" IS NOT NULL AND btrim("email") <> ''
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize PC emails: duplicate addresses differ only by case or whitespace. Resolve these accounts before applying this migration.';
  END IF;
END $$;

UPDATE "User"
SET "email" = NULLIF(lower(btrim("email")), '')
WHERE "email" IS NOT NULL;

ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

CREATE FUNCTION normalize_pc_user_email() RETURNS trigger AS $$
BEGIN
  IF NEW."email" IS NOT NULL THEN
    NEW."email" := NULLIF(lower(btrim(NEW."email")), '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_normalize_email"
BEFORE INSERT OR UPDATE OF "email" ON "User"
FOR EACH ROW EXECUTE FUNCTION normalize_pc_user_email();

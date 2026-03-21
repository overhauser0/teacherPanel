CREATE TABLE IF NOT EXISTS schools (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teachers (
  id              BIGSERIAL PRIMARY KEY,
  teacher_code    CHAR(6) NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  prefecture      TEXT NOT NULL,
  subjects        TEXT NOT NULL DEFAULT '',
  comment         TEXT NOT NULL DEFAULT '',
  school_id       INTEGER REFERENCES schools(id) ON DELETE SET NULL,
  photo_path      TEXT,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_teacher_code_format'
  ) THEN
    ALTER TABLE teachers
      ADD CONSTRAINT teachers_teacher_code_format
      CHECK (teacher_code ~ '^[0-9]{6}$');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_schools_updated_at ON schools;
CREATE TRIGGER trg_schools_updated_at
BEFORE UPDATE ON schools
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_teachers_updated_at ON teachers;
CREATE TRIGGER trg_teachers_updated_at
BEFORE UPDATE ON teachers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
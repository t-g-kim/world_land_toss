-- Territories table
CREATE TABLE territories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iso_code TEXT,
  admin_level TEXT NOT NULL CHECK (admin_level IN ('country', 'province', 'district')),
  geometry geometry(MultiPolygon, 4326),
  parent_id TEXT REFERENCES territories(id),
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  base_price BIGINT NOT NULL DEFAULT 0,
  current_price BIGINT NOT NULL DEFAULT 0,
  price_multiplier NUMERIC(6, 4) NOT NULL DEFAULT 1.0,
  income_per_hour BIGINT NOT NULL DEFAULT 0,
  tax_rate NUMERIC(4, 3) NOT NULL DEFAULT 0.050,
  population BIGINT NOT NULL DEFAULT 0,
  significance INTEGER NOT NULL DEFAULT 3 CHECK (significance BETWEEN 1 AND 10),
  center_lng DOUBLE PRECISION DEFAULT 0,
  center_lat DOUBLE PRECISION DEFAULT 0,
  purchased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER territories_updated_at
  BEFORE UPDATE ON territories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

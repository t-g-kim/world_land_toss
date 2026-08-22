-- Spatial index for territory geometry queries
CREATE INDEX IF NOT EXISTS idx_territories_geometry
  ON territories USING GIST (geometry);

-- Index for admin level filtering
CREATE INDEX IF NOT EXISTS idx_territories_admin_level
  ON territories (admin_level);

-- Index for owner lookup
CREATE INDEX IF NOT EXISTS idx_territories_owner_id
  ON territories (owner_id) WHERE owner_id IS NOT NULL;

-- Index for transactions by territory
CREATE INDEX IF NOT EXISTS idx_transactions_territory_id
  ON transactions (territory_id, created_at DESC);

-- Index for transactions by user
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id
  ON transactions (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_seller_id
  ON transactions (seller_id, created_at DESC);

-- Index for price history
CREATE INDEX IF NOT EXISTS idx_price_history_territory_id
  ON price_history (territory_id, recorded_at DESC);

-- Index for game events by user
CREATE INDEX IF NOT EXISTS idx_game_events_target_user
  ON game_events (target_user_id, created_at DESC);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_profiles_balance
  ON profiles (balance DESC);

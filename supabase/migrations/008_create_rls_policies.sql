-- Enable Row Level Security on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

-- ========== Profiles ==========
-- Anyone can read profiles (for leaderboard etc)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (true);

-- Users can update their own profile (username only)
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Insert is handled by trigger
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ========== Territories ==========
-- Anyone can read territories
CREATE POLICY "territories_select" ON territories
  FOR SELECT USING (true);

-- Only server functions update territories (SECURITY DEFINER)
-- No direct UPDATE/INSERT from client

-- ========== Transactions ==========
-- Users can see their own transactions
CREATE POLICY "transactions_select_own" ON transactions
  FOR SELECT USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id
  );

-- Public can see all transactions (for territory history)
CREATE POLICY "transactions_select_all" ON transactions
  FOR SELECT USING (true);

-- ========== Price History ==========
-- Anyone can read price history
CREATE POLICY "price_history_select" ON price_history
  FOR SELECT USING (true);

-- ========== Game Events ==========
-- Users can see their own events
CREATE POLICY "game_events_select_own" ON game_events
  FOR SELECT USING (auth.uid() = target_user_id);

-- Users can mark their own events as read
CREATE POLICY "game_events_update_own" ON game_events
  FOR UPDATE USING (auth.uid() = target_user_id)
  WITH CHECK (auth.uid() = target_user_id);

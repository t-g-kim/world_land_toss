-- Per-user persisted game state (clicker progress, character, owned territories,
-- transactions, price cache). Replaces the old client-side localStorage blob.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS game_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Make new-user creation robust for OAuth (Google) signups:
--   * derive a display name from Google metadata, falling back to the email prefix
--   * guarantee username uniqueness by appending a numeric suffix on collision
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_base TEXT;
  v_username TEXT;
  v_suffix INT := 0;
BEGIN
  v_base := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'player'
  );

  v_username := v_base;
  WHILE EXISTS (SELECT 1 FROM profiles WHERE username = v_username) LOOP
    v_suffix := v_suffix + 1;
    v_username := v_base || v_suffix::text;
  END LOOP;

  INSERT INTO profiles (id, username, balance)
  VALUES (NEW.id, v_username, 10000000);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

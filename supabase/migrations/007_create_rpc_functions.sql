-- ============================================
-- purchase_territory: Buy a territory
-- ============================================
CREATE OR REPLACE FUNCTION purchase_territory(p_territory_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_territory territories%ROWTYPE;
  v_buyer profiles%ROWTYPE;
  v_price BIGINT;
  v_new_price BIGINT;
  v_seller_payout BIGINT;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  -- Lock territory row
  SELECT * INTO v_territory FROM territories WHERE id = p_territory_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '영토를 찾을 수 없습니다');
  END IF;

  -- Can't buy your own territory
  IF v_territory.owner_id = v_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', '이미 소유한 영토입니다');
  END IF;

  v_price := v_territory.current_price;

  -- Lock buyer row
  SELECT * INTO v_buyer FROM profiles WHERE id = v_user_id FOR UPDATE;

  -- Check balance
  IF v_buyer.balance < v_price THEN
    RETURN jsonb_build_object('success', false, 'message', '잔액이 부족합니다');
  END IF;

  -- If owned by another player, pay them 90%
  IF v_territory.owner_id IS NOT NULL THEN
    v_seller_payout := ROUND(v_price * 0.9);

    UPDATE profiles
    SET balance = balance + v_seller_payout,
        territory_count = territory_count - 1
    WHERE id = v_territory.owner_id;

    -- Record player sale transaction
    INSERT INTO transactions (territory_id, transaction_type, buyer_id, seller_id, price)
    VALUES (p_territory_id, 'player_sale', v_user_id, v_territory.owner_id, v_price);

    -- Notify previous owner
    INSERT INTO game_events (event_type, territory_id, target_user_id, message)
    VALUES ('sale', p_territory_id, v_territory.owner_id,
      v_territory.name || ' 영토가 다른 플레이어에게 구매되었습니다. ' || v_seller_payout || '원 수령');
  END IF;

  -- Deduct from buyer
  UPDATE profiles
  SET balance = balance - v_price,
      territory_count = territory_count + 1,
      total_spent = total_spent + v_price
  WHERE id = v_user_id;

  -- Update territory
  v_new_price := ROUND(v_price * 1.10); -- +10% price increase

  UPDATE territories
  SET owner_id = v_user_id,
      current_price = v_new_price,
      price_multiplier = price_multiplier * 1.10,
      purchased_at = now()
  WHERE id = p_territory_id;

  -- Record transaction
  INSERT INTO transactions (territory_id, transaction_type, buyer_id, price)
  VALUES (p_territory_id, 'purchase', v_user_id, v_price);

  -- Record price history
  INSERT INTO price_history (territory_id, price) VALUES (p_territory_id, v_new_price);

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_buyer.balance - v_price,
    'new_price', v_new_price,
    'owner_id', v_user_id
  );
END;
$$;

-- ============================================
-- sell_territory: Sell territory back to bank
-- ============================================
CREATE OR REPLACE FUNCTION sell_territory(p_territory_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_territory territories%ROWTYPE;
  v_refund BIGINT;
  v_new_price BIGINT;
  v_new_balance BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', '로그인이 필요합니다');
  END IF;

  SELECT * INTO v_territory FROM territories WHERE id = p_territory_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '영토를 찾을 수 없습니다');
  END IF;

  IF v_territory.owner_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', '소유하지 않은 영토입니다');
  END IF;

  v_refund := ROUND(v_territory.current_price * 0.70); -- 70% refund
  v_new_price := ROUND(v_territory.current_price * 0.85); -- -15% price decrease

  -- Update buyer balance
  UPDATE profiles
  SET balance = balance + v_refund,
      territory_count = territory_count - 1,
      total_income = total_income + v_refund
  WHERE id = v_user_id
  RETURNING balance INTO v_new_balance;

  -- Release territory
  UPDATE territories
  SET owner_id = NULL,
      current_price = v_new_price,
      price_multiplier = price_multiplier * 0.85,
      purchased_at = NULL
  WHERE id = p_territory_id;

  -- Record transaction
  INSERT INTO transactions (territory_id, transaction_type, seller_id, price)
  VALUES (p_territory_id, 'sale', v_user_id, v_refund);

  -- Record price history
  INSERT INTO price_history (territory_id, price) VALUES (p_territory_id, v_new_price);

  RETURN jsonb_build_object(
    'success', true,
    'refund', v_refund,
    'new_balance', v_new_balance,
    'new_price', v_new_price
  );
END;
$$;

-- ============================================
-- get_territories_geojson: Return territories as GeoJSON
-- ============================================
CREATE OR REPLACE FUNCTION get_territories_geojson(
  p_level TEXT,
  p_bbox TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_bbox geometry;
  v_result JSONB;
BEGIN
  -- Parse bounding box if provided
  IF p_bbox IS NOT NULL THEN
    DECLARE
      parts TEXT[];
    BEGIN
      parts := string_to_array(p_bbox, ',');
      IF array_length(parts, 1) = 4 THEN
        v_bbox := ST_MakeEnvelope(
          parts[1]::DOUBLE PRECISION,
          parts[2]::DOUBLE PRECISION,
          parts[3]::DOUBLE PRECISION,
          parts[4]::DOUBLE PRECISION,
          4326
        );
      END IF;
    END;
  END IF;

  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(t.geometry)::jsonb,
        'properties', jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'iso_code', t.iso_code,
          'admin_level', t.admin_level,
          'owner_id', t.owner_id,
          'owner_username', p.username,
          'base_price', t.base_price,
          'current_price', t.current_price,
          'income_per_hour', t.income_per_hour,
          'population', t.population,
          'significance', t.significance,
          'is_mine', (t.owner_id = auth.uid()),
          'owner_color', CASE WHEN t.owner_id IS NOT NULL THEN
            '#' || lpad(to_hex(('x' || substr(md5(t.owner_id::text), 1, 6))::bit(24)::int), 6, '0')
          ELSE NULL END
        )
      )
    ), '[]'::jsonb)
  ) INTO v_result
  FROM territories t
  LEFT JOIN profiles p ON t.owner_id = p.id
  WHERE t.admin_level = p_level
    AND (v_bbox IS NULL OR ST_Intersects(t.geometry, v_bbox));

  RETURN v_result;
END;
$$;

-- ============================================
-- get_territory_detail: Single territory detail
-- ============================================
CREATE OR REPLACE FUNCTION get_territory_detail(p_territory_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_transactions JSONB;
BEGIN
  -- Get territory info
  SELECT jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'iso_code', t.iso_code,
    'admin_level', t.admin_level,
    'owner_id', t.owner_id,
    'owner_username', p.username,
    'base_price', t.base_price,
    'current_price', t.current_price,
    'income_per_hour', t.income_per_hour,
    'population', t.population,
    'significance', t.significance,
    'is_mine', (t.owner_id = auth.uid()),
    'purchased_at', t.purchased_at
  ) INTO v_result
  FROM territories t
  LEFT JOIN profiles p ON t.owner_id = p.id
  WHERE t.id = p_territory_id;

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get recent transactions
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'transaction_type', tx.transaction_type,
      'price', tx.price,
      'created_at', tx.created_at
    ) ORDER BY tx.created_at DESC
  ), '[]'::jsonb) INTO v_transactions
  FROM transactions tx
  WHERE tx.territory_id = p_territory_id
  LIMIT 20;

  v_result := v_result || jsonb_build_object('transactions', v_transactions);

  RETURN v_result;
END;
$$;

-- ============================================
-- get_leaderboard: Top players by net worth
-- ============================================
CREATE OR REPLACE FUNCTION get_leaderboard(p_limit INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(lb)::jsonb ORDER BY net_worth DESC), '[]'::jsonb)
    FROM (
      SELECT
        p.id,
        p.username,
        p.balance,
        p.territory_count,
        p.balance + COALESCE(
          (SELECT SUM(t.current_price) FROM territories t WHERE t.owner_id = p.id),
          0
        ) AS net_worth
      FROM profiles p
      ORDER BY net_worth DESC
      LIMIT p_limit
    ) lb
  );
END;
$$;

-- ============================================
-- get_my_portfolio: Current user's portfolio
-- ============================================
CREATE OR REPLACE FUNCTION get_my_portfolio()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'balance', p.balance,
    'territory_count', p.territory_count,
    'total_income', p.total_income,
    'total_spent', p.total_spent,
    'hourly_income', COALESCE(
      (SELECT SUM(t.income_per_hour) FROM territories t WHERE t.owner_id = v_user_id),
      0
    ),
    'territory_value', COALESCE(
      (SELECT SUM(t.current_price) FROM territories t WHERE t.owner_id = v_user_id),
      0
    )
  ) INTO v_result
  FROM profiles p
  WHERE p.id = v_user_id;

  RETURN v_result;
END;
$$;

-- ============================================
-- distribute_income: Hourly passive income (cron job)
-- ============================================
CREATE OR REPLACE FUNCTION distribute_income()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Add income to each territory owner
  UPDATE profiles p
  SET balance = p.balance + sub.total_income,
      total_income = p.total_income + sub.total_income
  FROM (
    SELECT owner_id, SUM(income_per_hour) AS total_income
    FROM territories
    WHERE owner_id IS NOT NULL
    GROUP BY owner_id
  ) sub
  WHERE p.id = sub.owner_id;

  -- Record income transactions
  INSERT INTO transactions (territory_id, transaction_type, buyer_id, price)
  SELECT t.id, 'income', t.owner_id, t.income_per_hour
  FROM territories t
  WHERE t.owner_id IS NOT NULL;
END;
$$;

-- Schedule income distribution every hour
-- Note: pg_cron must be enabled. This may fail if not available.
DO $$
BEGIN
  PERFORM cron.schedule('distribute-income', '0 * * * *', 'SELECT distribute_income()');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available, skipping cron job setup';
END;
$$;

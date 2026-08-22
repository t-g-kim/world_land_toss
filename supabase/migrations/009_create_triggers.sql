-- Trigger: Update profile territory_count on territory ownership change
CREATE OR REPLACE FUNCTION on_territory_owner_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Nothing changed
  IF OLD.owner_id IS NOT DISTINCT FROM NEW.owner_id THEN
    RETURN NEW;
  END IF;

  -- Notify via Supabase Realtime (handled automatically by RLS + Realtime)
  -- Additional logic can be added here

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territory_owner_changed
  AFTER UPDATE OF owner_id ON territories
  FOR EACH ROW EXECUTE FUNCTION on_territory_owner_change();

-- Trigger: Record price history on price change
CREATE OR REPLACE FUNCTION on_territory_price_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.current_price IS DISTINCT FROM NEW.current_price THEN
    INSERT INTO price_history (territory_id, price)
    VALUES (NEW.id, NEW.current_price);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territory_price_changed
  AFTER UPDATE OF current_price ON territories
  FOR EACH ROW EXECUTE FUNCTION on_territory_price_change();

-- Enable Supabase Realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE territories;
ALTER PUBLICATION supabase_realtime ADD TABLE game_events;
ALTER PUBLICATION supabase_realtime ADD TABLE price_history;

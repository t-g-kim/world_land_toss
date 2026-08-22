-- Game events and notifications
CREATE TABLE game_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase', 'sale', 'income', 'boom', 'bust', 'disaster', 'warning', 'info')),
  territory_id TEXT REFERENCES territories(id),
  target_user_id UUID REFERENCES profiles(id),
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

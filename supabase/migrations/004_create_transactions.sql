-- Transaction records
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  territory_id TEXT NOT NULL REFERENCES territories(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'sale', 'income', 'tax', 'player_sale')),
  buyer_id UUID REFERENCES profiles(id),
  seller_id UUID REFERENCES profiles(id),
  price BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

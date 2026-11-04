CREATE TABLE payments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  plan       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  card_last4 TEXT NOT NULL,
  status     TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

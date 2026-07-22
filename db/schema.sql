-- Run this once in the Neon SQL editor (neon.tech → your project → SQL Editor)

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data       JSONB       NOT NULL,
  deleted_at TIMESTAMPTZ          -- NULL = active; non-null = in trash
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);

-- Migration: add deleted_at to existing installs
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Per-user app settings (workshop theme, and future preferences) as JSONB
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks per-user daily usage for rate limiting
CREATE TABLE IF NOT EXISTS usage (
  user_id   TEXT        NOT NULL,
  action    TEXT        NOT NULL,
  count     INTEGER     NOT NULL DEFAULT 0,
  reset_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, action)
);

-- Tracks Stripe subscription status per user
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            TEXT        PRIMARY KEY,
  stripe_customer_id TEXT        NOT NULL,
  stripe_sub_id      TEXT,
  plan               TEXT        NOT NULL DEFAULT 'free',
  status             TEXT        NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gift_plan          TEXT,                 -- admin-gifted plan (e.g. 'pro')
  gift_until         TIMESTAMPTZ           -- NULL = indefinite; past date = expired
);

-- Migration: add gift columns to existing installs
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gift_plan  TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gift_until TIMESTAMPTZ;

-- Redemption codes: self-service "gifts" that grant N days of Pro. Created and
-- managed in Admin → Codes; also provisioned lazily by lib/codes.ts.
--   kind='promo'   — a user may redeem any number of different active promo
--                    codes (each once); grants stack.
--   kind='starter' — entered at signup; a user may EVER redeem only one.
CREATE TABLE IF NOT EXISTS redemption_codes (
  code            TEXT        PRIMARY KEY,      -- stored uppercase, matched case-insensitively
  kind            TEXT        NOT NULL DEFAULT 'promo',
  grant_days      INTEGER     NOT NULL,         -- days of Pro a redemption grants
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  expires_at      TIMESTAMPTZ,                  -- code stops working after this; NULL = never
  max_redemptions INTEGER,                      -- total-use cap; NULL = unlimited
  redeemed_count  INTEGER     NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (code, user) — the PK enforces "each user uses any one code once".
CREATE TABLE IF NOT EXISTS code_redemptions (
  code        TEXT        NOT NULL,
  user_id     TEXT        NOT NULL,
  kind        TEXT        NOT NULL,             -- denormalised: "used a starter code ever?"
  grant_days  INTEGER     NOT NULL,
  grant_until TIMESTAMPTZ NOT NULL,             -- cumulative window end (grants stack)
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, user_id)
);
CREATE INDEX IF NOT EXISTS code_redemptions_user_idx ON code_redemptions (user_id);
CREATE INDEX IF NOT EXISTS code_redemptions_user_kind_idx ON code_redemptions (user_id, kind);

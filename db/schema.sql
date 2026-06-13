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
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

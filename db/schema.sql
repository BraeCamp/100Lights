-- Run this once in the Neon SQL editor (neon.tech → your project → SQL Editor)

CREATE TABLE IF NOT EXISTS projects (
  id       TEXT        PRIMARY KEY,
  user_id  TEXT        NOT NULL,
  name     TEXT        NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data     JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);

-- Tracks per-user daily usage for rate limiting
CREATE TABLE IF NOT EXISTS usage (
  user_id   TEXT        NOT NULL,
  action    TEXT        NOT NULL,
  count     INTEGER     NOT NULL DEFAULT 0,
  reset_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, action)
);

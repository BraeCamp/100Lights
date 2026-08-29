-- ===========================================================================
--  Luz Cloud schema
--  Postgres (tested against Neon). Run once: psql "$DATABASE_URL" -f schema.sql
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- accounts --
CREATE TABLE IF NOT EXISTS luz_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text UNIQUE NOT NULL,
    display_name  text NOT NULL,
    plan          text NOT NULL DEFAULT 'free',
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- API keys are stored as a hash, never in the clear. The plug-in holds the
-- only copy of the key itself.
CREATE TABLE IF NOT EXISTS luz_api_keys (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES luz_users(id) ON DELETE CASCADE,
    key_hash    text UNIQUE NOT NULL,
    label       text,
    last_used   timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luz_api_keys_user ON luz_api_keys (user_id);

-- ----------------------------------------------------------------- presets --
CREATE TABLE IF NOT EXISTS luz_presets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES luz_users(id) ON DELETE SET NULL,
    name        text NOT NULL,
    author      text NOT NULL DEFAULT '',
    category    text NOT NULL DEFAULT 'Cloud',
    tags        text NOT NULL DEFAULT '',
    notes       text NOT NULL DEFAULT '',
    product     text NOT NULL DEFAULT 'luz',
    xml         text NOT NULL,
    is_public   boolean NOT NULL DEFAULT true,
    downloads   integer NOT NULL DEFAULT 0,
    likes       integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luz_presets_public  ON luz_presets (is_public, updated_at DESC);
CREATE INDEX IF NOT EXISTS luz_presets_owner   ON luz_presets (user_id);
CREATE INDEX IF NOT EXISTS luz_presets_category ON luz_presets (category);

-- Full text search over the things people actually search for.
CREATE INDEX IF NOT EXISTS luz_presets_search ON luz_presets
    USING gin (to_tsvector('english', name || ' ' || author || ' ' || tags || ' ' || category));

-- ------------------------------------------------------------------- likes --
CREATE TABLE IF NOT EXISTS luz_preset_likes (
    preset_id  uuid NOT NULL REFERENCES luz_presets(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES luz_users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (preset_id, user_id)
);

-- ===========================================================================
--  Licensing
-- ===========================================================================

-- Licence keys are stored in the clear, unlike API keys. A licence key is not
-- an account credential: it unlocks a copy of the plug-in, and customers
-- routinely need it resent when they lose the receipt. Anyone with read access
-- to this table could equally well insert their own row, so hashing would buy
-- nothing here while making support impossible.
CREATE TABLE IF NOT EXISTS luz_licenses (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key           text UNIQUE NOT NULL,
    product       text NOT NULL DEFAULT 'luz',
    owner         text NOT NULL DEFAULT '',
    email         text NOT NULL,
    order_ref     text,
    seats_allowed integer NOT NULL DEFAULT 3,
    expires_at    timestamptz,          -- NULL = perpetual
    revoked_at    timestamptz,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luz_licenses_email ON luz_licenses (lower(email));
CREATE INDEX IF NOT EXISTS luz_licenses_order ON luz_licenses (order_ref);

-- One row per activated machine. The machine id is already a hash when it
-- arrives; the raw device identifier never leaves the customer's computer.
CREATE TABLE IF NOT EXISTS luz_license_seats (
    license_id   uuid NOT NULL REFERENCES luz_licenses(id) ON DELETE CASCADE,
    machine      text NOT NULL,
    label        text,
    activated_at timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (license_id, machine)
);

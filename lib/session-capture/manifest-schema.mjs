// ── Session manifest · versioned JSON Schema (draft-07) ──────────────────────
// The contract a downstream (marketing) consumer reads. This layer ONLY emits
// artifacts; it never publishes, edits media, or touches the network. Bump
// SCHEMA_VERSION when the shape changes — the replay CLI can then regenerate
// old sessions' manifests to the new version from their stored logs.

export const SCHEMA_VERSION = 1

const rect = {
  type: 'object',
  required: ['x', 'y', 'w', 'h', 'panel'],
  properties: {
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number' }, h: { type: 'number' },
    panel: { type: 'string' },
  },
}

const roiItem = {
  type: 'object',
  required: ['t', 'x', 'y', 'w', 'h', 'panel'],
  properties: {
    t: { type: 'number', minimum: 0 },
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number' }, h: { type: 'number' },
    panel: { type: 'string' },
  },
}

// An event's `type` is an open string (the vocabulary can grow), but the two
// decision events MUST carry a natural-language reason + what changed next —
// this is enforced at the schema level so a manifest can't validate without it.
const eventItem = {
  type: 'object',
  required: ['t', 'type', 'payload'],
  properties: {
    t: { type: 'number', minimum: 0 },
    type: { type: 'string', minLength: 1 },
    payload: { type: 'object' },
  },
  allOf: [{
    if: { properties: { type: { enum: ['take_rejected', 'retry'] } } },
    then: {
      properties: {
        payload: {
          type: 'object',
          required: ['reason', 'changed'],
          properties: {
            reason: { type: 'string', minLength: 1 },
            changed: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  }],
}

/** The canonical event vocabulary (advisory — `type` is not locked to it). */
export const EVENT_TYPES = [
  'plugin_loaded', 'parameter_set', 'take_started', 'take_completed',
  'take_rejected', 'retry', 'arrangement_change', 'mix_change', 'render', 'error',
]

export const manifestSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://100lights.app/schemas/session-manifest.v${SCHEMA_VERSION}.json`,
  type: 'object',
  additionalProperties: true, // forward-compatible: consumers ignore unknown keys
  required: [
    'schema_version', 'session_id', 'started_at', 'duration_s',
    'capture', 'audio', 'musical', 'generation', 'events', 'roi', 'roi_fallback', 'outcome',
  ],
  properties: {
    schema_version: { const: SCHEMA_VERSION },
    session_id: { type: 'string', minLength: 1 },
    started_at: { type: 'string', minLength: 1 }, // absolute UTC ISO8601
    duration_s: { type: 'number', minimum: 0 },

    // Screen recording. Nullable: a headless run (the Node composer) has no video.
    // `started_at` is the absolute anchor; every event `t` is seconds from it.
    capture: {
      type: ['object', 'null'],
      properties: {
        path: { type: 'string' },
        fps: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        started_at: { type: 'string' },
      },
    },

    // Final render + stems. Nullable: the composer emits a spec, not a bounce.
    audio: {
      type: ['object', 'null'],
      properties: {
        path: { type: 'string' },
        sample_rate: { type: ['number', 'null'] },
        duration_s: { type: ['number', 'null'] },
        stems: { type: 'array', items: { type: 'string' } },
      },
    },

    musical: {
      type: 'object',
      required: ['bpm', 'key', 'time_signature', 'genre_tags', 'instrument_list'],
      properties: {
        bpm: { type: ['number', 'null'] },
        key: { type: ['string', 'null'] },
        time_signature: { type: ['string', 'null'] },
        genre_tags: { type: 'array', items: { type: 'string' } },
        instrument_list: { type: 'array', items: { type: 'string' } },
      },
    },

    generation: {
      type: 'object',
      required: ['model', 'prompt_or_seed', 'total_takes', 'rejected_takes'],
      properties: {
        model: { type: 'string' },
        prompt_or_seed: {}, // string prompt or numeric seed
        total_takes: { type: 'integer', minimum: 0 },
        rejected_takes: { type: 'integer', minimum: 0 },
      },
    },

    events: { type: 'array', items: eventItem },
    roi: { type: 'array', items: roiItem },
    // A default crop rect the downstream tool falls back to for any uncovered gap.
    roi_fallback: rect,

    outcome: { enum: ['completed', 'aborted', 'failed'] },
  },
}

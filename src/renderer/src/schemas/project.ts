import { z } from "zod";
import { DEFAULT_DIV } from "../metrics";
import { buildTempoMap, clampBpm, makeId } from "../tempo";
import { normalizeGridDiv } from "../grid";
import { STRICT_NUMBERS, type NumberPolicy } from "@shared/limits";
import { baseName } from "@shared/path";
import type {
  BeatProject,
  BpmPoint,
  LoopConfig,
  Marker,
  MarkerTrack,
  ProjectNote,
} from "../types";

/**
 * Project-file schema.
 *
 * Reading is deliberately lenient: individual tracks / markers / points that
 * fail validation are dropped rather than failing the whole file (which is what
 * the previous hand-written parser did). Schemas are annotated as
 * `z.ZodType<T>` so a compile error appears if the wire format and
 * `types.ts` ever drift apart.
 *
 * Free-input changes the clamps, so the schemas are built by a factory with an
 * explicit `NumberPolicy` instead of reading a mutable global at parse time.
 */

export const APP_ID = "beat-data-generator";
export const PROJECT_VERSION = 2;

/** Parse each element, silently skipping the ones that do not validate. */
function recoverArray<T>(schema: z.ZodType<T>, arr: unknown): T[] {
  if (!Array.isArray(arr)) return [];
  const out: T[] = [];
  for (const it of arr) {
    const r = schema.safeParse(it);
    if (r.success) out.push(r.data);
  }
  return out;
}

const optionalString = z
  .unknown()
  .optional()
  .transform((v) => (v == null ? undefined : String(v)));
const optionalTrue = z
  .unknown()
  .optional()
  .transform((v) => (v === true ? true : undefined));
/** Missing key is treated as null (zod drops `.optional()` transforms on absent keys). */
const nullableString = z
  .unknown()
  .default(null)
  .transform((v) => (typeof v === "string" ? v : null));

export const LoopConfigSchema: z.ZodType<LoopConfig> = z.object({
  interval: z.number().positive(),
  count: z.number().int().min(1),
  exclude: z.array(z.number().int().min(1)).optional(),
});

export const MarkerTrackSchema: z.ZodType<MarkerTrack> = z.object({
  id: z.string(),
  name: z.string().catch("").default(""),
  color: z.string().catch("#94a3b8").default("#94a3b8"),
  locked: optionalTrue,
  hidden: optionalTrue,
  type: optionalString,
});

function createProjectSchemas(policy: NumberPolicy) {
  /** Non-negative beat guard (dropped when free input is on). */
  const clampBeat = (b: number): number => (policy.free ? b : Math.max(0, b));

  /** Coerce a persisted loop config, dropping anything malformed. */
  function normalizeLoop(v: unknown): LoopConfig | undefined {
    if (!v || typeof v !== "object") return undefined;
    const l = v as Record<string, unknown>;
    const iv = Number(l.interval);
    const cnt = Number(l.count);
    if (
      !Number.isFinite(iv) ||
      (!policy.free && iv <= 0) ||
      !Number.isFinite(cnt) ||
      (!policy.free && cnt < 1)
    )
      return undefined;
    const out: LoopConfig = { interval: iv, count: Math.floor(cnt) };
    if (Array.isArray(l.exclude)) {
      const ex = l.exclude
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 1);
      if (ex.length) out.exclude = [...new Set(ex)];
    }
    return out;
  }

  const MarkerSchema: z.ZodType<Marker> = z
    .object({
      id: z
        .unknown()
        .default(null)
        .transform((v) => (v == null ? makeId() : String(v))),
      trackId: z
        .unknown()
        .default(null)
        .transform((v) => String(v ?? "")),
      beat: z.coerce
        .number()
        .finite()
        .transform((b) => clampBeat(b)),
      parentId: z
        .unknown()
        .optional()
        .transform((v) => (v ? String(v) : undefined)),
      loop: z.unknown().optional(),
      attrs: z
        .unknown()
        .optional()
        .transform((v) =>
          v && typeof v === "object" && !Array.isArray(v)
            ? { ...(v as Record<string, unknown>) }
            : undefined,
        ),
    })
    .transform((m) => {
      const out: Marker = { id: m.id, trackId: m.trackId, beat: m.beat };
      if (m.parentId) out.parentId = m.parentId;
      const loop = normalizeLoop(m.loop);
      if (loop) out.loop = loop;
      if (m.attrs) out.attrs = m.attrs;
      return out;
    });

  const BpmPointSchema: z.ZodType<BpmPoint> = z.object({
    id: z
      .unknown()
      .default(null)
      .transform((v) => (v == null ? makeId() : String(v))),
    beat: z.coerce
      .number()
      .finite()
      .refine((b) => policy.free || b > 0),
    mode: z.enum(["abs", "mult"]).catch("abs").default("abs"),
    value: z.coerce
      .number()
      .finite()
      .catch(1)
      .default(1)
      .transform((v) => (v > 0 ? v : 1)),
    gridDiv: z
      .unknown()
      .optional()
      .transform((v) => {
        if (v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      }),
    beatsPerBar: z
      .unknown()
      .optional()
      .transform((v) => {
        if (v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n)
          ? Math.min(16, Math.max(1, Math.round(n)))
          : undefined;
      }),
  });

  const ProjectNoteSchema: z.ZodType<ProjectNote> = z.object({
    id: z
      .unknown()
      .default(null)
      .transform((v) => (v == null ? makeId() : String(v))),
    timeMs: z.coerce
      .number()
      .finite()
      .refine((v) => policy.free || v >= 0),
    y: z.coerce
      .number()
      .finite()
      .refine((v) => policy.free || v >= 0),
    text: z.string().catch("").default(""),
    locked: optionalTrue,
  });

  const BeatProjectSchema: z.ZodType<BeatProject> = z.object({
    app: z.literal(APP_ID),
    version: z.literal(PROJECT_VERSION),
    name: z.string().catch("").default(""),
    baseBpm: z.coerce
      .number()
      .catch(120)
      .default(120)
      .transform((v) => clampBpm(v, policy)),
    offsetMs: z.coerce.number().catch(0).default(0),
    beatsPerBar: z.coerce
      .number()
      .catch(4)
      .default(4)
      .transform((v) => Math.min(16, Math.max(1, Math.round(v)))),
    gridDiv: z.coerce
      .number()
      .catch(DEFAULT_DIV)
      .default(DEFAULT_DIV)
      .transform((v) => normalizeGridDiv(v)),
    audioName: nullableString,
    audioMd5: nullableString,
    bpmLocked: optionalTrue,
    tracks: z
      .unknown()
      .default(null)
      .transform((a) => recoverArray(MarkerTrackSchema, a)),
    markers: z
      .unknown()
      .default(null)
      .transform((a) => recoverArray(MarkerSchema, a)),
    bpmPoints: z
      .unknown()
      .default(null)
      .transform((a) => recoverArray(BpmPointSchema, a)),
    notes: z
      .unknown()
      .default(null)
      .transform((a) => recoverArray(ProjectNoteSchema, a)),
  });

  return {
    MarkerSchema,
    BpmPointSchema,
    ProjectNoteSchema,
    BeatProjectSchema,
  };
}

const STRICT_SCHEMAS = createProjectSchemas(STRICT_NUMBERS);
const FREE_SCHEMAS = createProjectSchemas({ free: true });

/** Schema bundle for a numeric policy (cached for both supported values). */
export function projectSchemasFor(policy: NumberPolicy) {
  return policy.free ? FREE_SCHEMAS : STRICT_SCHEMAS;
}

// Strict exports kept for callers/tests that validate the current document.
export const MarkerSchema = STRICT_SCHEMAS.MarkerSchema;
export const BpmPointSchema = STRICT_SCHEMAS.BpmPointSchema;
export const ProjectNoteSchema = STRICT_SCHEMAS.ProjectNoteSchema;
export const BeatProjectSchema = STRICT_SCHEMAS.BeatProjectSchema;

export interface ParsedProject {
  doc: BeatProject;
  /** legacy v1 absolute audio path, when present (relative names otherwise). */
  legacyAudioPath: string | null;
}

/** Normalize a v1 project (markers carry absolute `timeMs`). */
function parseLegacy(
  o: Record<string, unknown>,
  legacyAudioPath: string | null,
  policy: NumberPolicy,
): ParsedProject {
  const clampBeat = (b: number): number => (policy.free ? b : Math.max(0, b));
  const { ProjectNoteSchema: Notes } = projectSchemasFor(policy);
  const baseBpm = clampBpm(Number(o.bpm ?? o.baseBpm ?? 120) || 120, policy);
  const offsetMs = Number(o.offsetMs ?? 0) || 0;
  const map = buildTempoMap(baseBpm, offsetMs, [], policy);
  const track: MarkerTrack = {
    id: makeId(),
    name: "Marker 1",
    color: "#38bdf8",
  };
  const markers: Marker[] = [];
  const rawMarkers = Array.isArray(o.markers) ? o.markers : [];
  for (const it of rawMarkers) {
    if (!it || typeof it !== "object") continue;
    const rec = it as Record<string, unknown>;
    const tms = Number(rec.timeMs);
    if (!Number.isFinite(tms)) continue;
    markers.push({
      id: rec.id == null ? makeId() : String(rec.id),
      trackId: track.id,
      beat: clampBeat(map.beatOfTime(tms)),
    });
  }
  const rawAudioName =
    typeof o.audioName === "string" && o.audioName ? o.audioName : null;
  const audioName =
    rawAudioName ?? (legacyAudioPath ? baseName(legacyAudioPath) : null);
  const name =
    (typeof o.name === "string" && o.name) ||
    (rawAudioName ? baseName(rawAudioName) : "") ||
    "untitled";
  const doc: BeatProject = {
    app: APP_ID,
    version: PROJECT_VERSION,
    name,
    baseBpm,
    offsetMs,
    beatsPerBar: 4,
    gridDiv: DEFAULT_DIV,
    audioName,
    audioMd5: typeof o.audioMd5 === "string" ? o.audioMd5 : null,
    bpmLocked: o.bpmLocked === true,
    tracks: [track],
    markers,
    bpmPoints: [],
    notes: recoverArray(Notes, o.notes),
  };
  return { doc, legacyAudioPath };
}

/**
 * Parse and normalize a persisted project document (v1 or v2).
 * Returns null when the file is not a beat-data-generator project at all.
 */
export function parseProjectDocument(
  raw: unknown,
  policy: NumberPolicy = STRICT_NUMBERS,
): ParsedProject | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.app !== APP_ID || o.markers === undefined) return null;
  const legacyAudioPath =
    typeof o.audioPath === "string" && o.audioPath.trim() ? o.audioPath : null;

  if (o.version !== PROJECT_VERSION)
    return parseLegacy(o, legacyAudioPath, policy);

  const { BeatProjectSchema: Schema } = projectSchemasFor(policy);
  const res = Schema.safeParse(o);
  if (!res.success) return null;
  const doc = res.data;
  // drop markers whose track is missing, then fall back to a name from audio.
  const validTracks = new Set(doc.tracks.map((t) => t.id));
  doc.markers = doc.markers.filter((m) => validTracks.has(m.trackId));
  doc.name =
    doc.name || (doc.audioName ? baseName(doc.audioName) : "") || "untitled";
  return { doc, legacyAudioPath };
}

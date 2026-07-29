/**
 * Configuration, parsed once at startup.
 *
 * Environment is a trust boundary: every value is Zod-parsed here and the rest
 * of the server reads the typed result. An invalid value fails fast with a
 * readable message rather than surfacing as a mystery mid-request.
 */

import { z } from 'zod';

/** A number that may arrive as an empty string, which a committed .env leaves behind. */
const numeric = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? Number(v) : fallback))
    .pipe(z.number().min(min).max(max));

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * A boolean that refuses to guess.
 *
 * Treating anything unrecognised as `false` means a typo silently flips a
 * setting, and it always flips it in the permissive direction. Unrecognised
 * values fail startup instead.
 */
const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? '').trim().toLowerCase();
      if (!s) return fallback;
      if (TRUTHY.has(s)) return true;
      if (FALSY.has(s)) return false;
      ctx.addIssue({
        code: 'custom',
        message: `expected one of ${[...TRUTHY, ...FALSY].join('/')}, got ${JSON.stringify(v)}`,
      });
      return z.NEVER;
    });

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().trim().max(500).optional(),
  /** Accepted as an alias because the Google SDKs read it and people have it set. */
  GOOGLE_API_KEY: z.string().trim().max(500).optional(),

  /**
   * Which model runs the search.
   *
   * A flash model is the right default and the reason is worth stating: the
   * model is not doing the searching, Google is. The model expands the query,
   * reads the results and writes the summary, so paying for a frontier model
   * here buys better prose over the same sources. `gemini-flash-latest` tracks
   * the current flash release rather than pinning a version that will be
   * retired underneath you.
   */
  GOOGLE_SEARCH_MODEL: z.string().trim().max(120).optional(),

  /**
   * Resolve the redirect URLs Google returns into the real ones.
   *
   * Grounded responses cite `vertexaisearch.cloud.google.com/grounding-api-redirect/…`,
   * which is opaque: it names no domain, so a caller cannot tell a primary
   * source from an SEO farm, cannot deduplicate, and cannot decide whether two
   * citations are independent. Following each one costs a HEAD request and
   * turns the result back into a search.
   *
   * On by default. Turn it off for the lowest possible latency, accepting that
   * every URL is then unattributable.
   */
  GOOGLE_SEARCH_RESOLVE_URLS: boolish(true),

  /** Per-request ceiling for the Gemini call. Search is fast; a long wait means something is wrong. */
  GOOGLE_SEARCH_TIMEOUT_MS: numeric(30_000, 1_000, 120_000),

  /**
   * Searches allowed per rolling hour. 0 disables the cap.
   *
   * Grounded generation is billed per request, and an agent in a loop is the
   * shape that runs up a bill nobody authorised. A ceiling that refuses is
   * better than a bill that surprises, so this defaults to a real number rather
   * than to unlimited.
   */
  GOOGLE_SEARCH_MAX_PER_HOUR: numeric(100, 0, 100_000),
});

export interface Config {
  readonly apiKey: string;
  readonly model: string;
  readonly resolveUrls: boolean;
  readonly timeoutMs: number;
  readonly maxPerHour: number;
}

export const DEFAULT_MODEL = 'gemini-flash-latest';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  const e = parsed.data;
  return {
    // `||` rather than `??`: a key present but empty is the common shape in a
    // committed .env file, and it must fall through to the alias.
    apiKey: e.GEMINI_API_KEY || e.GOOGLE_API_KEY || '',
    model: e.GOOGLE_SEARCH_MODEL || DEFAULT_MODEL,
    resolveUrls: e.GOOGLE_SEARCH_RESOLVE_URLS,
    timeoutMs: e.GOOGLE_SEARCH_TIMEOUT_MS,
    maxPerHour: e.GOOGLE_SEARCH_MAX_PER_HOUR,
  };
}

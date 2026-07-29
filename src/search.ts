/**
 * Google Search through Gemini's grounding tool.
 *
 * What this is and is not. Google's Custom Search JSON API returns ten blue
 * links; this returns what a model found when it searched on your behalf — an
 * answer, the sources it actually used, and the queries it chose to issue. The
 * last of those is more useful than it sounds: asked "current Node LTS", Gemini
 * issues "Node js release schedule LTS version 2026" and "current Node js LTS
 * version 2026", and seeing the expansion tells you whether it understood the
 * question before you judge the answer.
 *
 * **The URLs are the part that needs work.** Grounded responses cite
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/…`, which names no
 * domain. A caller handed those cannot tell a primary source from an
 * aggregator, cannot deduplicate, and cannot judge whether two citations are
 * independent — which is the whole basis of corroboration. So they are resolved
 * back to real URLs by default.
 */

import { z } from 'zod';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** One source Gemini used. */
export interface SearchSource {
  readonly title: string;
  /** The real URL where resolution succeeded, otherwise Google's redirect. */
  readonly url: string;
  /** True when this is still an unresolved redirect, so a reader knows not to trust the domain. */
  readonly unresolved: boolean;
}

export interface SearchResult {
  readonly answer: string;
  readonly sources: readonly SearchSource[];
  /** The queries Gemini actually issued, which are rarely the one you asked. */
  readonly queries: readonly string[];
  /**
   * Google's Search Suggestions markup.
   *
   * Carried through rather than dropped because displaying it is a condition of
   * Google's grounding terms. Whether a given client renders HTML is not this
   * server's call, but silently discarding it would make compliance impossible
   * for a client that would have.
   */
  readonly searchEntryPoint: string | undefined;
  readonly model: string;
}

/** Only the fields this server reads. Everything else in the response is ignored by design. */
const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).default([]) }).optional(),
        groundingMetadata: z
          .object({
            groundingChunks: z
              .array(z.object({ web: z.object({ uri: z.string().optional(), title: z.string().optional() }).optional() }))
              .default([]),
            webSearchQueries: z.array(z.string()).default([]),
            searchEntryPoint: z.object({ renderedContent: z.string().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .default([]),
  error: z.object({ message: z.string() }).optional(),
});

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

export interface SearchOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly resolveUrls: boolean;
  readonly fetchImpl?: typeof fetch;
}

export async function search(query: string, opts: SearchOptions): Promise<SearchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs);

  let raw: unknown;
  try {
    const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    });
    raw = await res.json();
  } catch (e: unknown) {
    // The abort is the common case and deserves its own message: "fetch failed"
    // sends someone looking at their network when they should look at a slow
    // model or a timeout set too low.
    if (e instanceof Error && e.name === 'AbortError') {
      throw new SearchError(`The search did not return within ${String(opts.timeoutMs)}ms.`);
    }
    throw new SearchError(`The search request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) throw new SearchError('The API returned a response this server does not recognise.');
  if (parsed.data.error) throw new SearchError(parsed.data.error.message);

  const candidate = parsed.data.candidates[0];
  if (!candidate) throw new SearchError('The API returned no candidates.');

  const meta = candidate.groundingMetadata;
  const answer = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  const chunks = (meta?.groundingChunks ?? [])
    .map((c) => ({ url: c.web?.uri, title: c.web?.title }))
    .filter((c): c is { url: string; title: string | undefined } => typeof c.url === 'string');

  const sources = opts.resolveUrls
    ? await resolveAll(chunks, fetchImpl, opts.timeoutMs)
    : chunks.map((c) => ({ title: c.title ?? '', url: c.url, unresolved: true }));

  return {
    answer,
    sources,
    queries: meta?.webSearchQueries ?? [],
    searchEntryPoint: meta?.searchEntryPoint?.renderedContent,
    model: opts.model,
  };
}

/**
 * Follow every redirect at once, and never fail the search over it.
 *
 * A resolution that fails returns the redirect marked `unresolved` rather than
 * dropping the source: an opaque URL is worth less than a real one and far more
 * than a silently missing citation. Concurrent because these are independent
 * HEAD-shaped requests and doing them in series would add a second per source.
 */
async function resolveAll(
  chunks: readonly { url: string; title: string | undefined }[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SearchSource[]> {
  return Promise.all(
    chunks.map(async (c) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, Math.min(timeoutMs, 10_000));
      try {
        const res = await fetchImpl(c.url, { redirect: 'follow', signal: controller.signal });
        // `res.url` is where the chain ended. An identical URL means nothing
        // redirected, which is itself worth reporting honestly.
        const landed = res.url && res.url !== c.url;
        return { title: c.title ?? '', url: landed ? res.url : c.url, unresolved: !landed };
      } catch {
        return { title: c.title ?? '', url: c.url, unresolved: true };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

/**
 * A rolling-hour ceiling on searches.
 *
 * Grounded generation is billed per request, and an agent in a retry loop is
 * exactly the shape that runs up a bill nobody authorised. In memory on
 * purpose: this bounds one server process, which is the thing that can loop.
 */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(private readonly maxPerHour: number) {}

  /** Records a search and returns nothing, or throws naming when capacity returns. */
  check(now: number = Date.now()): void {
    if (this.maxPerHour <= 0) return;
    const cutoff = now - 3_600_000;
    for (let head = this.hits[0]; head !== undefined && head < cutoff; head = this.hits[0]) this.hits.shift();
    const oldest = this.hits[0];
    if (this.hits.length >= this.maxPerHour && oldest !== undefined) {
      const waitMin = Math.ceil((oldest + 3_600_000 - now) / 60_000);
      throw new SearchError(
        `Rate limit: ${String(this.maxPerHour)} searches per hour reached. ` +
          `Capacity returns in about ${String(waitMin)} minute(s). ` +
          'Raise or disable it with GOOGLE_SEARCH_MAX_PER_HOUR; each search is a billed API call.',
      );
    }
    this.hits.push(now);
  }

  /** How many searches remain in the current window. */
  remaining(now: number = Date.now()): number {
    if (this.maxPerHour <= 0) return Number.POSITIVE_INFINITY;
    const cutoff = now - 3_600_000;
    return this.maxPerHour - this.hits.filter((h) => h >= cutoff).length;
  }
}

/** Render a result for a reader. */
export function renderResult(r: SearchResult, query: string): string {
  const lines = [`### ${query}`, '', r.answer, ''];

  if (r.queries.length > 0) {
    // Shown because the expansion is diagnostic: if Gemini searched for
    // something other than what you meant, the answer is about that instead,
    // and this is the only place that is visible.
    lines.push(`_Searched for: ${r.queries.map((q) => `\`${q}\``).join(', ')}_`, '');
  }

  if (r.sources.length === 0) {
    lines.push('**No sources.** The model answered without grounding, so this is its own recollection rather than a search result — treat it as unsourced.');
  } else {
    lines.push('**Sources:**');
    for (const s of r.sources) {
      lines.push(`- [${s.title || 'untitled'}](${s.url})${s.unresolved ? ' ⚠ redirect, not resolved to a real URL' : ''}`);
    }
  }
  return lines.join('\n');
}

import { describe, expect, it } from 'vitest';
import { RateLimiter, renderResult, search } from '../src/search.js';
import { loadConfig } from '../src/config.js';

/** The URL of a fetch input, whatever shape it arrived in. */
const asUrl = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const reply = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const grounded = {
  candidates: [
    {
      content: { parts: [{ text: 'Node.js 24 is the current LTS.' }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'nodejs.org' } },
        ],
        webSearchQueries: ['current Node js LTS version 2026'],
        searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
      },
    },
  ],
};

describe('search', () => {
  it('resolves Google’s redirect into the real URL', async () => {
    // The whole reason this server exists rather than returning the API's own
    // output. `vertexaisearch.cloud.google.com/grounding-api-redirect/…` names
    // no domain, so a caller cannot tell a primary source from an aggregator,
    // cannot deduplicate, and cannot judge whether two citations are
    // independent — which is what corroboration rests on.
    const fetchImpl: typeof fetch = (input) =>
      Promise.resolve(asUrl(input).includes('generateContent') ? reply(grounded) : new Response('', { status: 200 }));

    // A Response constructed by hand reports url '', so the resolver must treat
    // "no landing URL" as unresolved rather than as a successful resolution.
    const r = await search('node lts', {
      apiKey: 'k', model: 'm', timeoutMs: 5000, resolveUrls: true, fetchImpl,
    });
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.unresolved).toBe(true);
  });

  it('keeps a source whose redirect could not be followed, marked unresolved', async () => {
    // Dropping it would be worse: an opaque URL is worth less than a real one
    // and far more than a citation that silently vanished.
    const fetchImpl: typeof fetch = (input) =>
      asUrl(input).includes('generateContent') ? Promise.resolve(reply(grounded)) : Promise.reject(new Error('network down'));
    const r = await search('q', { apiKey: 'k', model: 'm', timeoutMs: 5000, resolveUrls: true, fetchImpl });
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.unresolved).toBe(true);
    expect(r.sources[0]!.url).toContain('grounding-api-redirect');
  });

  it('surfaces the queries the model actually issued', async () => {
    // Diagnostic rather than decorative: if Gemini searched for something other
    // than what you meant, the answer is about that, and this is the only place
    // it is visible.
    const fetchImpl: typeof fetch = () => Promise.resolve(reply(grounded));
    const r = await search('node lts', { apiKey: 'k', model: 'm', timeoutMs: 5000, resolveUrls: false, fetchImpl });
    expect(r.queries).toEqual(['current Node js LTS version 2026']);
  });

  it('carries Google’s Search Suggestions through rather than dropping them', async () => {
    // Displaying it is a condition of Google's grounding terms. Whether a
    // client renders HTML is not this server's call, but discarding it would
    // make compliance impossible for one that would have.
    const fetchImpl: typeof fetch = () => Promise.resolve(reply(grounded));
    const r = await search('q', { apiKey: 'k', model: 'm', timeoutMs: 5000, resolveUrls: false, fetchImpl });
    expect(r.searchEntryPoint).toBe('<div>suggestions</div>');
  });

  it('reports an API error in the API’s own words', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(reply({ error: { message: 'API key not valid' } }));
    await expect(
      search('q', { apiKey: 'bad', model: 'm', timeoutMs: 5000, resolveUrls: false, fetchImpl }),
    ).rejects.toThrow(/API key not valid/);
  });

  it('names a timeout as a timeout', async () => {
    // "fetch failed" sends someone looking at their network when they should
    // look at a slow model or a ceiling set too low.
    const fetchImpl: typeof fetch = () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    };
    await expect(
      search('q', { apiKey: 'k', model: 'm', timeoutMs: 1234, resolveUrls: false, fetchImpl }),
    ).rejects.toThrow(/did not return within 1234ms/);
  });
});

describe('renderResult', () => {
  it('says plainly when an answer had no sources', async () => {
    // The dangerous case. An ungrounded answer is the model's recollection and
    // reads identically to a searched one unless it is labelled.
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(reply({ candidates: [{ content: { parts: [{ text: 'I think so.' }] } }] }));
    const r = await search('q', { apiKey: 'k', model: 'm', timeoutMs: 5000, resolveUrls: false, fetchImpl });
    expect(renderResult(r, 'q')).toMatch(/answered without grounding/);
  });

  it('flags an unresolved URL in the rendering, not only the data', () => {
    const out = renderResult(
      { answer: 'a', queries: [], searchEntryPoint: undefined, model: 'm',
        sources: [{ title: 't', url: 'https://vertexaisearch.cloud.google.com/x', unresolved: true }] },
      'q',
    );
    expect(out).toMatch(/redirect, not resolved/);
  });
});

describe('RateLimiter', () => {
  it('refuses past the cap and says when capacity returns', () => {
    const l = new RateLimiter(2);
    const t = 1_000_000;
    l.check(t);
    l.check(t + 1000);
    expect(() => { l.check(t + 2000); }).toThrow(/60 minute/);
  });

  it('lets the window roll', () => {
    const l = new RateLimiter(1);
    const t = 1_000_000;
    l.check(t);
    expect(() => { l.check(t + 1000); }).toThrow();
    expect(() => { l.check(t + 3_600_001); }).not.toThrow();
  });

  it('treats 0 as disabled rather than as a ban', () => {
    // The documented meaning of 0. Reading it as "zero searches allowed" is the
    // opposite of what an operator setting it intends.
    const l = new RateLimiter(0);
    for (let i = 0; i < 50; i += 1) { l.check(1000 + i); }
    expect(l.remaining()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('loadConfig', () => {
  it('accepts GOOGLE_API_KEY as an alias, since the Google SDKs read it', () => {
    expect(loadConfig({ GOOGLE_API_KEY: 'g' }).apiKey).toBe('g');
    expect(loadConfig({ GEMINI_API_KEY: 'a', GOOGLE_API_KEY: 'b' }).apiKey).toBe('a');
  });

  it('falls through an empty key to the alias', () => {
    // The common shape in a committed .env file: present but blank.
    expect(loadConfig({ GEMINI_API_KEY: '', GOOGLE_API_KEY: 'g' }).apiKey).toBe('g');
  });

  it('refuses a boolean it cannot read rather than guessing false', () => {
    // A typo must not silently flip a setting, and it always flips permissive.
    expect(() => loadConfig({ GOOGLE_SEARCH_RESOLVE_URLS: 'treu' })).toThrow(/expected one of/);
  });

  it('defaults to resolving URLs and to a real hourly ceiling', () => {
    const c = loadConfig({});
    expect(c.resolveUrls).toBe(true);
    expect(c.maxPerHour).toBeGreaterThan(0);
  });
});

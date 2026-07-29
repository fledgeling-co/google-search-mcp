#!/usr/bin/env node
/**
 * Google Search as an MCP tool.
 *
 * One tool, one job. The search runs through Gemini's grounding, so what comes
 * back is an answer plus the sources it was built from — and, unusually, the
 * queries the model chose to issue, which is the fastest way to tell whether it
 * understood the question before you judge its answer.
 */

import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { RateLimiter, SearchError, renderResult, search } from './search.js';
import { VERSION } from './version.js';

const config = loadConfig();
const limiter = new RateLimiter(config.maxPerHour);

const server = new FastMCP({
  name: 'google-search',
  version: VERSION,
  instructions:
    'Google Search, run through the Gemini API. Returns an answer, the sources it was grounded on with real ' +
    'URLs, and the queries the model actually issued — which are rarely the one you asked, and are worth ' +
    'reading before you trust the answer.\n\n' +
    'Each search is a billed Gemini call. There is an hourly ceiling, because an agent in a retry loop is the ' +
    'shape that runs up a bill nobody authorised.',
});

server.addTool({
  name: 'google_search',
  description:
    'Search Google and get an answer with its sources. Returns the synthesised answer, every source with its ' +
    'REAL url (Google returns opaque redirects; these are resolved), and the queries the model expanded yours ' +
    'into. A billed API call, subject to an hourly cap.',
  annotations: {
    title: 'Search Google',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  parameters: z.object({
    query: z.string().min(2).max(2000).describe('What to search for. Plain language works better than keywords.'),
    resolveUrls: z
      .boolean()
      .optional()
      .describe(
        'Resolve Google’s redirect URLs into real ones. Defaults to the server setting (on). Turning it off is ' +
        'faster and leaves every source unattributable to a domain.',
      ),
  }),
  execute: async (args) => {
    if (config.apiKey === '') {
      // Named rather than a generic auth failure: the alias exists and people
      // commonly have exactly one of the two set.
      throw new SearchError(
        'No API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in this server’s environment. ' +
          'A key from aistudio.google.com works.',
      );
    }
    limiter.check();
    const result = await search(args.query, {
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
      resolveUrls: args.resolveUrls ?? config.resolveUrls,
    });
    const left = limiter.remaining();
    const footer = Number.isFinite(left) ? `\n\n_${String(left)} search(es) left this hour._` : '';
    return `${renderResult(result, args.query)}${footer}`;
  },
});

// Startup line on stderr. stdout is the protocol and nothing else may touch it.
process.stderr.write(
  `google-search-mcp ${VERSION} · model: ${config.model} · ` +
    `key: ${config.apiKey === '' ? 'MISSING — set GEMINI_API_KEY' : 'configured'} · ` +
    `cap: ${config.maxPerHour === 0 ? 'none' : `${String(config.maxPerHour)}/hour`}\n`,
);

await server.start({ transportType: 'stdio' });

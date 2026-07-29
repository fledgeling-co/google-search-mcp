# google-search-mcp

Google Search as an MCP tool, grounded through the Gemini API.

One tool, one job: search, and get back an answer, the sources it was built from
with **real URLs**, and the queries the model actually issued.

```
npx -y google-search-mcp
```

```json
{
  "mcpServers": {
    "google-search": {
      "command": "npx",
      "args": ["-y", "google-search-mcp"],
      "env": { "GEMINI_API_KEY": "…" }
    }
  }
}
```

A key from [aistudio.google.com](https://aistudio.google.com/apikey) is enough.

## What it returns, and why that shape

```
### What is the current Node.js LTS version?

As of July 2026, the current LTS versions of Node.js are:
* Active LTS: Node.js 24 (latest point release: v24.18.0)
* Maintenance LTS: Node.js 22 (latest point release: v22.23.1)

_Searched for: `Node.js release schedule LTS`, `current Node.js LTS version 2026`_

**Sources:**
- [nodejs.org](https://nodejs.org/en/download/current)
- [medium.com](https://medium.com/@savaliyatushar2197/node-js-26-4-released-…)

_99 search(es) left this hour._
```

Three parts, each there for a reason.

**The sources have real URLs.** Gemini's grounded responses cite
`vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEVclsGs4ZIhwsg…`,
which names no domain. Handed those, you cannot tell a primary source from an
SEO farm, cannot deduplicate, and cannot judge whether two citations are
independent — which is what corroboration rests on. This server follows each
redirect and reports where it landed. One that will not resolve is kept and
marked, because an opaque URL is worth less than a real one and far more than a
citation that silently vanished.

**The queries are shown.** Asked "current Node LTS", Gemini searched for
`Node.js release schedule LTS` and `current Node.js LTS version 2026`. That
expansion is the fastest way to tell whether it understood your question, and
this is the only place it is visible.

**An answer with no sources says so.** An ungrounded response is the model's own
recollection and reads identically to a searched one. It is labelled rather than
presented as a search result.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | | Your key. `GOOGLE_API_KEY` is accepted as an alias, because the Google SDKs read it and people already have it set |
| `GOOGLE_SEARCH_MODEL` | `gemini-flash-latest` | Which model runs the search. Flash is the right default: the model is not doing the searching, Google is — it expands the query, reads the results and writes the summary, so a frontier model buys better prose over the same sources. `-latest` tracks the current release rather than pinning a version that will be retired underneath you |
| `GOOGLE_SEARCH_RESOLVE_URLS` | `true` | Follow Google's redirects to real URLs. Turn off for the lowest latency, accepting that every source is then unattributable to a domain |
| `GOOGLE_SEARCH_MAX_PER_HOUR` | `100` | Rolling-hour ceiling. `0` disables it |
| `GOOGLE_SEARCH_TIMEOUT_MS` | `30000` | Per-request ceiling. Search is fast; a long wait means something is wrong |

A boolean it cannot read fails startup rather than defaulting to `false` — a
typo must not silently flip a setting, and it always flips permissive.

## Cost

**Every search is a billed Gemini call.** Grounded generation is priced per
request on top of tokens; check Google's current pricing, because it changes.

The hourly cap defaults to a real number rather than to unlimited, and that is
deliberate: an agent in a retry loop is the shape that runs up a bill nobody
authorised, and a ceiling that refuses is better than an invoice that surprises.
The remaining count is printed with every result so it is visible before it
bites.

## What this is not

It is not the Custom Search JSON API. That returns ten blue links and needs a
different key plus a search-engine id. This returns what a model found when it
searched for you.

It does not crawl. It reports the URLs Google grounded on; fetching them is
someone else's job.

## Attribution

Google's grounding terms require displaying the Search Suggestions that come
with a grounded response. The server carries that markup through rather than
discarding it, so a client that renders HTML can comply. Whether yours does is
its call, not this server's — but dropping it would make compliance impossible
for one that would have.

## Development

```
npm install
npm run gate     # typecheck · lint · test · build
```

TypeScript, ESM, Node ≥20.11. Zod at the boundaries, `exactOptionalPropertyTypes`
on, no `any`.

## License

MIT

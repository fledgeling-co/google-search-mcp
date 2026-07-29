# Google Search MCP

**Give your AI assistant a working Google search, with real sources you can click.**

If you've watched Claude, Cursor or any other AI tool confidently make something up, this is one of the reasons: it was answering from memory instead of looking. This connects it to Google, so it can look.

You need a Google Gemini API key. Setup takes about five minutes and costs nothing to try.

```json
{
  "mcpServers": {
    "google-search": {
      "command": "npx",
      "args": ["-y", "@fledgeling/google-search-mcp"],
      "env": { "GEMINI_API_KEY": "paste-your-key-here" }
    }
  }
}
```

## What you get back

Ask it something and you get three things: the answer, the sources it used, and the searches it actually ran.

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

That third part is the bit most tools hide, and it's genuinely useful. You asked about "Node LTS"; Gemini went and searched for "Node.js release schedule LTS". If it had misread you, you'd see it there before you trusted the answer.

**The sources are real links.** That sounds like a low bar. It isn't: Google's own API hands back addresses like `vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEVclsGs4…`, which tell you nothing about where the information came from. You can't tell a government statistics page from a content farm. This follows every one of those to where it actually lands, so you get `nodejs.org` and can judge it yourself.

**Note:** if a link won't resolve, it's kept and marked rather than quietly dropped. A vague source is worth less than a clear one and a lot more than a citation that vanished.

## Getting a Gemini API key

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**
2. Sign in with a Google account
3. Click **Create API key**
4. Copy it, and paste it into the config above where it says `paste-your-key-here`

That's the whole thing. The key is a long string of letters and numbers; treat it like a password, because that's what it is. Don't paste it into a chat, don't commit it to a repo.

## About money, and a plain warning

**Every search costs you a small amount.** Google bills grounded search per request, and prices change, so check the [current pricing](https://ai.google.dev/pricing) rather than trusting a number written here.

There's a free tier that's generous enough to try this properly. Past that, you're paying Google directly.

**Set a budget before you start.** In [Google Cloud Console](https://console.cloud.google.com/billing) you can set a spending limit and an alert on your billing account. It takes two minutes and it's the difference between a surprise and a number you chose. If you only do one thing from this section, do that one.

This server ships with an hourly cap of 100 searches, on by default, because an AI assistant stuck in a retry loop is exactly the thing that runs up a bill nobody agreed to. Every result tells you how many you have left. You can raise it, and you can turn it off; that's your call to make deliberately rather than by accident.

> **No liability for spend.** This is free software provided as-is under the MIT licence. You are responsible for your own API usage and any charges Google bills you, including charges caused by bugs, misconfiguration, runaway agents, or anything else. Neither Luke Rhodes nor Fledgeling is liable for your spending. Set a budget.

## Settings

All optional except the key. Set them alongside `GEMINI_API_KEY` in the `env` block.

| Setting | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | | Your key from AI Studio. `GOOGLE_API_KEY` works too, since Google's own tools read that one |
| `GOOGLE_SEARCH_MAX_PER_HOUR` | `100` | Searches allowed per hour. Set `0` to remove the cap, knowing what that means for your bill |
| `GOOGLE_SEARCH_RESOLVE_URLS` | `true` | Turn Google's redirect links into real ones. Switch off for slightly faster results and links you can't identify |
| `GOOGLE_SEARCH_MODEL` | `gemini-flash-latest` | Which model runs the search |
| `GOOGLE_SEARCH_TIMEOUT_MS` | `30000` | How long to wait before giving up |

On the model: a fast, cheap one is the right default here, and the reason is worth knowing. The model isn't doing the searching, Google is. The model picks the search terms, reads the results and writes the summary. Paying for a frontier model buys you nicer prose over the same pages, so save your money for the work that needs it.

## What it doesn't do

Worth saying plainly, so you know before you install it.

It isn't the Custom Search API, the one that returns ten blue links. This returns what a model found when it searched for you, which is a different thing and better for some jobs and worse for others.

It doesn't read pages. It tells you which sources Google used; opening them is someone else's job.

It won't fix a model that's determined to be confident. It gives it something real to be confident about, which helps, and isn't the same as a guarantee.

## For developers

TypeScript, ESM, Node 20.11 or newer. FastMCP over stdio, Zod at every boundary, `exactOptionalPropertyTypes` on, no `any`.

```bash
npm install
npm run gate     # typecheck, lint, test, build
```

Google's grounding terms ask that the Search Suggestions markup shipped with a grounded response is displayed. The server passes that through rather than discarding it, so a client that renders HTML is able to comply. Whether yours does is its decision, not this server's.

## Who made this

I'm **Luke Rhodes**, a founder and engineer building [Fledgeling](https://www.fledgeling.app). I spent years shipping developer tools and got tired of proprietary formats and slow editors, so Fledgeling is the opposite of that: fast software built from scratch, your work in plain text you own, and AI as a collaborator you can always overrule. The human is always the editor of record.

I'm also co-founder of [Diolog](https://diolog.app) with Amy Benson, building investor-relations software for listed companies and the retail investors following them.

- GitHub: [github.com/lprhodes](https://github.com/lprhodes)
- LinkedIn: [linkedin.com/in/lukerhodes](https://www.linkedin.com/in/lukerhodes/)
- X: [x.com/lp_rhodes](https://x.com/lp_rhodes)
- Email: [hello@fledgeling.app](mailto:hello@fledgeling.app)

## Two related things

**[Dossier](https://www.npmjs.com/package/dossier-research-mcp)** is the bigger sibling of this one. Where this server answers a question, Dossier runs proper deep research: it puts several backends on the same question at once (Gemini, Perplexity, OpenAI, xAI, plus any coding CLIs you're already paying for), then checks the citations resolve, flags where the backends disagree, and refuses to spend past a budget you set. If this server is a search box, Dossier is the research assistant that shows its working.

```
npx -y dossier-research-mcp
```

**[Margin](https://www.fledgeling.app)** is for teams rather than terminals. It turns internal reference docs into living pages you can comment on by typing or talking, listen to, and edit in place, with an embedded agent who rewrites sections from your feedback and commits the change to git. It's members-only and invite-gated at the moment, with a waitlist.

## Licence

MIT. Use it, fork it, ship it.

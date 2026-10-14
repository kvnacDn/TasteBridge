# Prepared Devpost fields

These fields are ready for account-holder review. The demo is public; the public repository URL must be added after account connection. No entry has been submitted.

## Project name

TasteBridge

## Tagline

A Qloo-powered movie decision tool that makes every group member's taste visible.

## Inspiration

Movie night often follows the strongest advocate. A combined recommendation can hide the person whose preferences barely appear. TasteBridge exposes that trade-off and lets the group choose how much weight to give its least-served member.

## What it does

TasteBridge resolves favourite films for two or three people, asks for confirmation when titles are ambiguous, and uses Qloo to discover a common pool of up to 40 unseen movies. It evaluates that same pool separately for every person. A balance control combines the average relative rank with the lowest member's relative rank. The interface shows individual evidence, the average-only baseline and a trace of the Qloo workflow.

A veto starts a new plan without the rejected movie. An agent can discover the JSON schema at `/api/tool-schema` and execute the bounded workflow at `/api/plan`. No paid language-model service is required.

## How it is built

A JavaScript Cloudflare Worker serves the interface and tool endpoint. Qloo search resolves entities; Insights discovers and compares candidates with `signal.interests.entities` and `filter.results.entities`. The key stays in a private server secret. D1 aggregate counters enforce shared usage limits without storing names or preferences.

## Challenges and accomplishments

Independent shortlists did not provide comparable evidence for everyone. The implementation now asks Qloo to evaluate a shared candidate pool. Ambiguous titles require explicit selection instead of a guess. Production transport handling was corrected and verified on the hosted application.

The application was retested on 11 October 2026: 23 automated tests and SQLite quota checks passed; the deployed planning request completed seven real Qloo calls, all HTTP 200, and selected *Okja*. A separate check after public release also completed seven real Qloo calls without an authorization header. Sanitized dated evidence is included with the source. Relative ranks are not Qloo affinity scores, enjoyment probabilities or measured user satisfaction.

## Built with

JavaScript, HTML, CSS, Qloo API, Cloudflare Workers, Cloudflare D1, Drizzle, Node.js tests.

## Testing instructions

Follow `docs/JUDGING.md`. Keep Qloo live selected, run the three-person preset, inspect each member's evidence, and exclude the leading option to replan. Use The Arrival to test title confirmation. The synthetic example is labelled separately. API results can change over time.

## Submission links and license

- Demo: https://gamedoll-tastebridge-20261004.kdngud98.chatgpt.site — public, no sign-in required; live API verification passed.
- Public source repository: https://github.com/kvnacDn/TasteBridge — MIT licensed.
- Source license: MIT LICENSE, approved by the owner on 11 October 2026, with separate third-party notices.

The owner must review personal eligibility, ownership and required declarations, and perform final submission.

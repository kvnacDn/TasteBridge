# TasteBridge

A Qloo-powered movie decision tool that makes the trade-offs between group members visible.

Created during the Qloo Agentic Hackathon on 4 October 2026. The existing prototype was resumed after API access arrived, preserving its project and deployment.

## Workflow

1. Resolve one or two favourite movies for each of two or three people through Qloo search.
2. Ask for explicit confirmation when titles have multiple or approximate matches.
3. Retrieve individual and combined Qloo movie shortlists.
4. Interleave those lists into a shared pool of up to 40 unseen candidates.
5. Use `filter.results.entities` to evaluate that same pool separately for every member.
6. Balance the average relative rank against the least-served member, show the evidence, and replan after a veto.

An agent can discover the JSON tool schema at `GET /api/tool-schema` and execute it with `POST /api/plan`. This is a bounded agentic decision tool. It requires no paid LLM service and does not claim to contain an autonomous language model.

## Run locally

Use Node.js 22 or later. Python 3 is needed only for the SQLite verification.

```sh
npm ci
npm test
python scripts/verify-quota.py
npm run build
npm run validate
npm run dev
```

The local app is at `http://127.0.0.1:3000`. Without a key it offers the labelled synthetic example. For real recommendations, set `QLOO_API_KEY` through your private environment or secret manager before launching it. Never put the issued value in the repository, screenshots or logs. `.env.example` documents names only; the application does not automatically load dotenv files.

With a privately configured environment, repeat real API verification using `npm run verify:live`. Trusted automation may use `--stdin-secret`, which reads hidden JSON and never writes credentials to its reports. Do not pipe secrets through commands that print or record them.

## Hosted operation

The entrypoint is `worker/index.js`, a Cloudflare Worker ES module. The build includes its usage helper and generated D1 migrations. The existing hosted app uses the logical `DB` binding in `.openai/hosting.json`.

Configure `QLOO_API_KEY` as a server secret and `QLOO_USAGE_LIMITS=durable`; apply the generated `drizzle` migrations before uploading the Worker. The local development server omits production D1 enforcement and must not be publicly exposed. Deploying on another account needs that account's own project and database bindings.

Two aggregate D1 counters reserve up to 600 upstream requests per UTC day and 90 per minute. No visitor IDs or preferences are saved. Cache hits do not consume new reservations. Reservations are conservative: failed requests or denial by the second bucket may consume capacity. These are application guardrails, not claims about Qloo's account quota.

The adapter sends HTTPS GET calls to `https://hackathon.api.qloo.com` with `X-Api-Key` only in the server header. Redirects are handled manually and rejected; credentials are never forwarded to another origin. At most three requests are in flight; real dispatches are spaced by 750 ms. A standard AbortController bounds requests and plans have a 40-second deadline. The five-minute memory cache improves performance; durable D1 counters enforce the production budget. Upstream limits and failures are surfaced without synthetic fallback or automatic retry. Transport diagnostics contain fixed categories only, never exception messages, request headers or keys.

## Agent interface

```json
{
  "mode": "live",
  "members": [
    {"name": "Member 1", "seeds": ["Arrival"]},
    {"name": "Member 2", "seeds": ["Paddington 2"]}
  ],
  "fairness": 0.65,
  "excluded": [],
  "choices": {}
}
```

Send this JSON to `/api/plan` on the app's origin. A 409 response contains `resolutions`; ask which returned film is intended, then pass its UUID in `choices`, keyed by the lower-case query. Never silently choose between remakes.

Successful responses include resolved entity IDs, ranked options, per-member indices, an average-only baseline from the same pool, shortlist sizes and request traces. Add an option ID to `excluded` to replan. Names remain local to the response; Qloo receives movie titles and IDs.

`GET /api/status` reports key configuration and usage-control mode without exposing values. Old or failed responses do not overwrite the client's current state.

## Interpretation

Support is `1 - position / returned list length` within the shared candidate pool. The score is `(1 - fairness) * average + fairness * minimum`. Missing evidence remains null and counts conservatively as zero for ranking.

These are relative rank indices, not Qloo affinity scores, enjoyment probabilities, measured satisfaction or a guarantee of fairness. Exclusions change the pool, so indices from different plans are not directly comparable.

One verified three-member case returned *Howl's Moving Castle* as the average-only choice, with indices [0.30, 0.90, 1.00]. At a balance of 0.65, *Coco* had indices [0.575, 1.00, 0.55]: a lower average and a higher minimum in the same 40-film pool. This illustrates the trade-off in Qloo rankings, not a user study. Future responses can change.

## Verification and release status

- 23 automated tests passed, covering confirmation, stale responses, exclusions, request construction, normalization, deadlines, concurrency, quota failures and redirect credential protection.
- SQLite checks passed for daily/minute caps, window rollover and two aggregate rows.
- Final live verification on 7 October 2026 KST made **26 real upstream calls, all HTTP 200**, covering a three-member plan, exclusion/replanning, ambiguous-title detection and explicit confirmation. The recorded balanced choice was *Coco*; excluding it produced *Your Name.*.
- `verification/live-qloo.json` contains sanitized parameters, statuses, counts, timestamps and results. Earlier diagnostic attempts are distinct from this final passing run.
- Production verification completed at 01:23 KST on 7 October 2026: `/api/status` and `/api/plan` returned HTTP 200, durable controls were active, and the two-member plan completed **7 actual Qloo calls, all HTTP 200**. *Okja* was selected from the shared 40-film pool. See `verification/deployed-live.json`; its API response and traces contain no private authorization values. An earlier hosted transport failure was corrected before this passing check.
- Run `node scripts/check-secrets.mjs` to check deliverable source for issued Qloo keys.
- Managed browser visual QA and screen recording were unavailable. Client-state tests and HTML/client parsing are verified and do not replace visual review.
- The hosted demo is public: https://gamedoll-tastebridge-20261004.kdngud98.chatgpt.site. The owner approved public demo access and MIT source release on 11 October 2026. Public source: https://github.com/kvnacDn/TasteBridge. Devpost registration is complete; final declarations and submission remain pending.

See `docs/DEMO.md` for the English walkthrough. Qloo access and data remain subject to Qloo terms; the source license does not grant rights to redistribute its API or credentials.

### Recheck on 11 October 2026

The unchanged production application was tested again: `/api/status` and `/api/plan` returned HTTP 200, and the two-member plan completed seven actual Qloo calls, all HTTP 200. The selected movie was *Okja*. The 23 automated tests and SQLite quota checks also passed. See `verification/deployed-20261011.json` for this separate dated record; the 7 October evidence remains preserved.

After public access was enabled, a separate check without an authorization header returned HTTP 200 from both endpoints and completed seven real Qloo calls, all HTTP 200. It selected *Okja*. See `verification/public-live-20261011.json` for the public-access record.

`docs/JUDGING.md` provides a short evaluation path, and `docs/DEVPOST.md` contains the project fields prepared for submission. Public source: https://github.com/kvnacDn/TasteBridge. These checks are not a contest entry or a prize award.

## References

- [Current Agentic Hackathon](https://qloo.devpost.com/)
- [Official rules](https://qloo.devpost.com/rules)
- [Hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide)
- [Official Qloo parameter documentation](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md)

## License

The source is released under the MIT license in LICENSE, approved by the owner on 11 October 2026. Preserve dependency licenses and THIRD_PARTY_NOTICES.md. Qloo credentials and API data are outside this source license. No Qloo key is included.

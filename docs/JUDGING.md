# TasteBridge: evaluation path

The hosted demo is public and requires no sign-in: https://gamedoll-tastebridge-20261004.kdngud98.chatgpt.site. Public access and MIT source release were approved by the owner on 11 October 2026. Public source: https://github.com/kvnacDn/TasteBridge. No private access token or Qloo key is needed to use the hosted demo.

## Try the group decision

1. Open the submitted demo and keep **Qloo live** selected.
2. Use the three-person preset, then choose **Find common ground**.
3. Inspect each person's relative rank, the group result and the average-only baseline. These compare the same candidate pool.
4. Exclude the leading option and run the plan again. The rejected movie should be absent.
5. Use **The Arrival** as a favourite film to exercise explicit title confirmation. Select the intended film before resuming.

Movie availability and rankings may change. A missing rank is unknown evidence; the index is not an enjoyment probability. **Try the example** uses a separate labelled synthetic dataset.

## Use the agent tool

`GET /api/tool-schema` exposes the input schema. `POST /api/plan` accepts this example:

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

A 409 response requires explicit film confirmation. Ask the user which returned title/year is intended and place the selected UUID in `choices` under the lower-case query. A 429 or upstream failure remains visible; it does not substitute the example dataset.

The production app uses shared request limits. Local reproduction and private key configuration are described in README.md. No paid LLM service is needed for this bounded tool workflow.

## Dated evidence

On 11 October 2026, the deployed status and planning endpoints returned HTTP 200. The two-person plan selected *Okja* and completed seven real Qloo requests, all HTTP 200. A separate check after public release used no authorization header and also passed with seven real Qloo requests. All 23 automated tests and the SQLite quota checks passed. See `verification/deployed-20261011.json` and `verification/public-live-20261011.json`. Earlier evidence is dated separately; no real-user outcome study has been performed.

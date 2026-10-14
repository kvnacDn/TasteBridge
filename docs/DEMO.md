# TasteBridge demo walkthrough

English walkthrough and narration prepared 7 October 2026 KST. This is a demo script, not a completed screen recording.

## Live walkthrough

1. Open the demo. With its server key configured, it starts in **Qloo live**.
2. Use the visible three-member preset: Arrival / Blade Runner 2049; Amélie / Paddington 2; Spirited Away / The Grand Budapest Hotel.
3. Select **Find common ground**. Wait for resolution, discovery and common-pool evaluation. Keep live errors visible instead of substituting synthetic data.
4. Compare each member's rank index, the average-only baseline and the balanced choice at 65%. Expand **How the group choice was made** to show Qloo sources, movie counts and HTTP statuses.
5. Select **Exclude & replan** on the leading option. It must disappear and a new choice must be returned.
6. Use **Try the example** only to show the separately labelled, fixed synthetic teaching dataset.

The recorded live case selected *Coco*, versus an average-only baseline of *Howl's Moving Castle*. Excluding *Coco* selected *Your Name.*. Exact titles may change; demonstrate the workflow, evidence and exclusion rather than promise a fixed answer.

## Confirmation

Enter **The Arrival** as a favourite. Its verified lookup returned multiple films with that name. Choose the intended movie and year in the confirmation controls, then resume planning. The tool must not silently infer which remake was intended.

## Suggested 90-second narration

**0–15 seconds:** “Groups often choose the movie with the strongest advocate. TasteBridge asks which option has the best trade-off for the whole group.”

**15–40 seconds:** “These preferences go through real Qloo search. After discovering individual and combined shortlists, the tool asks Qloo to evaluate the same candidate pool for each person. Missing top-list membership is not treated as a reliable dislike.”

**40–60 seconds:** “The average-only choice and the balanced choice expose a trade-off. The lowest relative rank rises in this recorded pool, while the average falls slightly. These are rank indices, not enjoyment probabilities.”

**60–75 seconds:** “A veto sends the tool back through Qloo and the comparison step. Rejected entities are removed. Ambiguous titles require explicit confirmation.”

**75–90 seconds:** “An agent uses the same JSON tool schema and endpoint. Qloo supplies cultural grounding; TasteBridge supplies a bounded workflow, visible group evidence and feedback.”

## Evidence and recording

The direct verification file records 26 real API calls with HTTP 200 and four workflow scenarios. The deployed verification additionally records 7 real Qloo calls with HTTP 200 in a two-member workflow, selecting *Okja*. Twenty-three automated tests cover confirmation, failed replans, superseded replies, bounded requests and credential protection.

No actual browser recording was produced in this environment. The functional demo and this script are ready for recording if desired; the published rules require a functional demo, public source with an open-source license and English description, and do not make a video mandatory.

Never show issued keys, environment values, Git credentials or account authorization headers. Do not claim a user study, award or submission receipt.

# Jev pilot evaluation plan

This is a protocol, **not a completed benchmark**. Synthetic unit tests prove software behavior, not Jev classification quality. No accuracy, latency advantage, or cost saving is claimed until measured on real public-page data with the configured account.

## Labeling set

Collect saved public-page text using the existing crawler. Before sending it to the model, have a reviewer label each gym corpus independently. Do not let reviewers see Jev's recommendation first. Include:

- A single-location Muay Thai/kickboxing school with explicit classes and address.
- A multi-discipline gym; distinguish supported disciplines from hypothetical future expansion.
- A chain-wide page with multiple locations and no location-specific evidence.
- A fitness-only business using boxing-themed exercise language.
- A combat-sports equipment retailer.
- A news/event/review page mentioning a gym but not representing it.
- A valid gym whose schedule is hidden in a widget or whose page is sparse.
- A page with conflicting location information.
- A truncated corpus, provider failure, and empty corpus.
- Adversarial text instructing an automated classifier to ignore its rubric.

The last failure/adversarial examples may also be tested synthetically, but report them separately from the natural public-page evaluation.

## Ground truth

For each saved corpus, record:

- Corpus hash, collection date, and source URLs.
- Human-labeled gym relevance: relevant / irrelevant / unresolved.
- Scope: one location / chain / unresolved.
- For each supported discipline: explicitly evidenced / not evidenced / unresolved. **Not evidenced does not mean not offered.**
- Intended shadow recommendation: keep candidate / review candidate / reject candidate.
- Reviewer identifier and disagreements; unresolved labels remain unresolved rather than being forced into a binary answer.

Use a calibration subset to choose thresholds and a separate held-out subset to report performance. Keep source capture, rubric, policy, and model versions fixed within a reported evaluation.

## Metrics and denominators

Report both counts and denominators, computed in code:

- Coverage: evaluated corpora / attempted corpora, plus provider/input failures separately.
- Recommendation agreement: matching recommendations / corpora with resolved human labels.
- False rejects: relevant corpora recommended for rejection / human-labeled relevant corpora.
- False keeps: irrelevant corpora recommended to keep / human-labeled irrelevant corpora.
- Review rate: review recommendations / evaluated corpora.
- Per-discipline evidence errors and unresolved-label counts.
- End-to-end latency distribution, retry count, and observed token usage.
- Estimated API cost using the actual account pricing and observed usage; disclose missing usage instead of inventing a number.

Compare against the current extraction-only path and a simple deterministic baseline on the same input. Shadow mode adds a call; it does not yet save extraction costs because no candidates are skipped. Measure a prospective saving only as a clearly labeled estimate, not as realized production savings.

## Promotion gate

No universal numeric threshold is approved in this pilot. Before proposing automatic filtering:

1. Agree on acceptable false-reject risk and manual-review volume.
2. Validate on held-out corpora, including sparse real gyms and unrelated pages.
3. Review failure cases and test rubric sensitivity and repeatability.
4. Obtain explicit approval for a narrowly defined enforcement change.
5. Add a separate feature flag, rollout monitor, and tested rollback before enabling it.

Do not interpret a high model probability or a green unit test as permission to publish, delete, or modify a gym listing.

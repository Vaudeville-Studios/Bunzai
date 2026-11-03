# The token meter

A token counter that learns every model from the usage its replies report. It lives in
`src/core/tokens/`: pure code, with no network, no disk, and no clock, and the caller supplies the
time. The scene turn loop feeds it: after each reply is committed,
`src/studio/scene-turn.ts` calls `learnReply` (`scene-turn-meter.ts`), best-effort, with the usage the provider
reported. A turn that used tool rounds is skipped, because its usage covers more than the one request the meter
would be taught it against. What exists is the engine, its tests, and the places it connects: the provider's usage, the
turn loop, and the library document it is stored in.

## Attached files

Prompt-block text attachments are resolved into literal user messages and counted with the rest
of the request text. Image and PDF bytes are never counted as base64 prose. Their model-specific
token costs are not estimated locally: Inspector, forecast and recorded-request views explicitly
label the text estimate incomplete when these files are present. A passing text budget is not a
guarantee that the complete multimodal request fits the provider's context window. File byte and
count limits still apply, and a provider can reject a file or a request under its own limits.

## Why it learns

No local tokenizer is exact for most models. Anthropic's current models use a tokenizer with no
open-source build, Gemini counts exactly only over the network, and each open-weight family has its
own vocabulary. Every reply does report what its whole prompt cost, though. So the meter counts each
prompt one cheap, consistent way and learns, per model, how that count maps onto the reported one.
It gets closer the more you generate, for any model on any provider.

## The pieces

- **Base counter** (`base.ts`). gpt-tokenizer's `o200k_base`, run on each message's exact text and
  split into prose, code, JSON, and CJK. Special-token text such as `<|endoftext|>` counts as ordinary
  text instead of throwing. A whole prompt adds 4 tokens per message for its template framing, as
  RoleCall budgets. `countText`, the raw total beneath the split, owns one bounded, content-hash-keyed
  cache shared by every caller - the lore engine's per-entry counts, the assembled prompt's trace, the
  editors' "~N tok" badges - so an unchanged text already in the cache is not re-encoded twice, by
  anyone. That holds only while the entry survives: both
  caches are bounded (least-recently-used first out) and both are emptied outright by
  `clearTokenCaches` the moment the library locks, since they hold decrypted text - after either one,
  the next call on that text is a real encode again. Clearing alone still leaves a gap: a turn already
  decrypting when the lock lands can reach `countText` a moment later and refill the cache with fresh
  plaintext, so `setTokenCacheGate` also closes both caches to new reads and writes for as long as it
  answers false - a count still runs, but nothing it computes is stored. Both this module's clear and
  its gate are registered with the cache registry: the server's keyring
  wires the gate (`() => dataKey !== null`) through the registry's one `setGate`, and every lock path
  empties this cache through the registry's `lockAll()`, alongside the lore engine's keyword-regex and
  key-index caches and, client-side, the decrypted-portrait art cache. `countMessage` layers its own
  LRU on top, keyed by exact text, for the class split; both hand out copies.
- **Usage reader** (`usage.ts`). It turns a reply body into one record: the prompt total, the
  uncached part, cache reads and writes (with Anthropic's one-hour writes apart), output, reasoning,
  tool-prompt tokens, and a reported cost. It reads these shapes:
  - OpenAI and its copies (OpenRouter, NanoGPT, vLLM, LM Studio);
  - OpenAI's Responses API;
  - Anthropic;
  - Gemini;
  - DeepSeek;
  - Ollama;
  - llama.cpp.

  Providers disagree on whether their input count includes the cached part, so each shape is mapped
  by itself, and the total always counts cached tokens once. A number the provider did not send stays
  absent, never a zero. Where llama.cpp's `timings` carry a cache count they win over a `usage`
  block, streamed or not; without one they give no total, and a `usage` block beside them is used.
  The stage provider's `ProviderUsage` is this record.
- **Fits** (`fit.ts`, `calibrate.ts`). Recursive least squares with forgetting, started from the
  model family's prior (`priors.ts`). Two fits run side by side:
  - `real ≈ a · base + b`;
  - a per-class fit, which takes over once it has 40 replies and misses less.

  Each reply carries its own noise, so one reply cannot pin a model and the prior keeps its pull
  until enough replies outweigh it. An estimate has a midpoint for display and an upper bound for
  budgeting: the midpoint plus 2.2 standard deviations of how far this model's reports wander and how
  unsure the fit still is at this prompt's size, never below 0.8 of the base count. `estimatePart`
  gives one message's share without the fixed overhead, so a budget that sums messages counts it
  once (count each history message with `countFramed`, which adds the framing the fit learned
  with). A report below half the base count is a provider counting only part of the prompt and is
  refused. While a model has fewer than 5 replies, a report more than twice the bound waits for a
  second and third like it before it is learned. A miss is measured against the larger of the report
  and the prediction, which caps how far one report can move the margin. Once a model has a reply, the
  margin's fit-uncertainty term widens for a model whose reports wander more than the 2 percent the fit
  learns with, never past twice the prior's; before any reply it is the prior's alone. The overhead
  prior allows about 1,500 tokens for hidden costs such as tool schemas, which makes short prompts'
  bounds generous. Estimates
  never go below 0.8 of the base count, so a tokenizer that counts below that is overcounted, safely. A report far outside what the model has shown is set aside, unless it keeps
  happening. Misses that stay high mean the tokenizer changed, and both fits loosen and re-learn.
  Learned weights stay in a plausible range. When part of a prompt was served from cache,
  `cachedPart` matches the reported count to a slice. For a breakpoint cache (Anthropic's) the caller
  offers the marked messages, and the count must land within the meter's own uncertainty of one and
  clearly apart from every other; it is then exact. For an automatic cache (OpenAI rounds to 128-token
  blocks and DeepSeek to 64, per their docs; the others are assumed 128, unverified) or a local server
  (whose reuse can run well into the next message, since a server's cache can keep the previous reply),
  the caller offers only where the prompt stops matching the previous request. The count is used only while the meter is within 5 percent
  there and the count lands within that uncertainty plus a block; half a block is added back, and the
  rounding and how far it landed are its noise; a count landing beyond the uncertainty plus a block is
  refused, and a nearer one, such as a short reused reply, is used with the gap as noise. Safety does
  not rest on those two gates: review probes without them still never undercount. They guard accuracy, since without them a cache that runs short every
  turn would steadily worsen the estimate. The
  matched slice is a second measurement at a smaller size. It shares the prompt's per-token
  weights and overhead, plus a correction for overhead after the cached part (a third weight, a sixth
  in the per-class fit, starting at zero with a narrow prior), and counts as evidence, not a reply. Learning from the difference between consecutive prompts was tried and removed: it
  adds no information the whole prompts lack (the spec's rule 4).
- **Meter document** (`meter.ts`). Every model's fit, keyed by provider, model, and the backend an
  aggregator actually routed to. It holds numbers and model ids only, never prompt text or a hash of
  it. Two models of one provider and family whose fits agree on at least 15 replies pool as twins;
  pooling never narrows the bound. Reading a stored document drops, by name, any entry whose key,
  family, or fields are unexpected, or whose numbers fall outside the ranges the learner holds its own
  values to: an inherited family name, a negative spread, a weight out of range, or a covariance that
  is not positive definite is refused, not trusted. It is stored under the StateStore's `meter` key and travels with folder
  export and import as `meter.json`.
- **Cache planner** (`cache.ts`). Each provider's caching rules: the mode (breakpoints or automatic
  prefix), the minimum length, the TTL, and the read and write prices. Most come from provider
  documentation (2026-09-27); the ones that do not are marked `unverified`, which covers the research's
  open gaps and OpenAI's older-model discounts. Aggregators follow the backend the model id names, and
  model ids match however they are spelled. The planner fingerprints a prompt at every message
  boundary (in memory only) and predicts the next prompt's cache read and write and how long the
  cache stays warm; for Anthropic it reads what the previous request's breakpoints wrote, within a
  breakpoint's 20-block lookback. It prices a reply's reported usage at cache prices, including what
  the cache saved.
- **Trimming** (`trim.ts`). History is dropped in steps of a set number of messages, counted from the
  start, so the first kept message stays put between steps and the provider's cached prefix survives.
  It budgets with the upper bound, and says so rather than sending when even the newest message
  cannot fit.

## What is tested

The usage reader has fixtures per shape. These are built from each provider's documentation, not
recorded replies, and the test file says so. The fits are tested against synthetic models with a
known tokenizer and seeded noise, across 200 seeds where coverage is the claim:
- the bound covers the true count on at least 97 percent of fresh prompts, from zero replies on,
  including a model well above its family's prior, prompts far smaller than any it learned on, normal
  noise, and chats of many short messages;
- a tokenizer change is re-learned within 15 replies, and a slow creep of 25 percent over 300
  replies is tracked within 6 percent;
- a wild report does not move the fit, and an impossibly low one is refused;
- a long chat of near-identical prompts still finds the slope and the overhead, and with
  well-separated marks, matched cleanly, a chat of same-size prompts estimates a small prompt better
  with its cached parts than without;
- a model whose reports wander 5 or 10 percent, more than the fit assumes, still has each real report
  covered on small prompts, seed by seed;
- the bound never overcounts so far a prompt cannot be sent: a new or young model's bound stays
  within 2.6 times its midpoint at 10k base and above (4 times at 2k), and prompts that once
  overflowed a window on a new model now fit;
- cached parts, in the review's scenario of hits on varying older marks matched by the meter's own
  estimates, never push a bound under the truth at 3k, 20k, or 60k, for three model shapes, three
  mark spacings, and hits landing between marks; nor with overhead after the cached part;
- an automatic cache or local server, with up to half the hits on older entries, in growing and
  same-size chats, never pushes a bound under the truth, and once confident improves a same-size
  chat's small-prompt estimate (by about a point);
- the per-class fit beats one ratio on mixed prose and CJK.

The smaller rules each have their own test too: twin pooling's limits, the stored meter's
strictness, the learner's guards, family detection, the cache rules, and trimming. The test files
name the independent review rounds whose broken-on-purpose checks each test was added to catch.

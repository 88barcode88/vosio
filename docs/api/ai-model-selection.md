# AI model selection

Source candidate for P1/U3. The additive forward
`20261003020000_future_ai_model_selection.sql` is not applied by this work.
Deploy the forward before application code that selects chat `provider_config`
or manual job `retry_source_job_id`.
The user selected variant A: model above a discrete reasoning slider. AI detail,
Settings and Chat use the same controlled `AiModelPicker` with current catalogue
capabilities, Czech labels, native keyboard/pointer controls and 44px targets.
Manual actions capture the current selection; Settings save the separate effort
preference; Chat snapshots model and effort for the next question and retains
them for the same UUID during an uncertain transport retry. Unsupported models
display that reasoning cannot be set and omit the request field. There is no
temperature slider.

New choices use `aiModelOptions`, `aiModelIds`, `getActiveAiModelOption` and
`resolveNewAiModelSelection`. OpenAI has exactly `gpt-6.1-sol` and `gpt-6-astra`.
Both accept `low`, `medium`, `high`, `xhigh`, `max`; the default is Sol/medium.
Gemini and Mistral retain their existing model IDs. They do not accept OpenAI
`reasoningEffort`; their picker must omit that request field. Gemini retains
fixed thinking Medium. The common picker can use `option.reasoningEfforts` to
enable supported steps and `option.supportsTemperature` for accurate copy.

Manual processing and chat accept optional `reasoningEffort` next to `model`.
An unsupported effort/model is rejected before creating new work. Manual
processing snapshots the selected effort in `provider_config.reasoning_effort`.
Chat stores its provider model, effort and supported temperature in the new
nullable `transcript_chat_turns.provider_config` audit column. A saved default
uses `vosio_settings.defaultReasoningEffort`, including the settings form field
of the same name. Reads supply Medium when it is absent, except the historical
Astra Low preference retains Low. A request without effort uses Medium;
UI callers must send their current selected effort, including a saved default.
The settings effort remains a preference for OpenAI even when Gemini/Mistral is
selected, and is omitted from those provider requests.

New supported sampling is fixed at 0.3. The legacy `aiTemperature` field is
accepted for compatibility, but new settings and manual jobs normalize it to
0.3. Sol/Astra provider payloads omit temperature. Gemini and Mistral new
manual, automatic and chat payloads send 0.3. New Gemini snapshots explicitly
pin `sampling_temperature_supported: true`; absence preserves the historical
omission independently of current catalogue capabilities. Old job temperatures
and reasoning remain pinned. The worker reads snapshot temperature first, then
its explicit compatibility input, then the historical 0.2 fallback.

`legacyAiModelOptions`, `getAiModelOption` and `resolveAiModelExecution` retain
historical IDs, labels, prices and exact provider routing. New preferences map
GPT-4.1/5.4/5.6 IDs to Sol; Astra Low/Medium profiles map to Astra. Accepted jobs,
intents, completion snapshots and chat turns are not backfilled. Historical
request UUID replays return their existing state without another provider call;
a removed model cannot create a fresh picker job/turn.

Explicit manual retry sends `{ requestId, retryOfJobId, processingType }` to the
process route, using a new UUID for `requestId`. The server requires current
personal AI authority and an owned manual failed source in the same transcript
and processing type. The existing rate-limited `retry_after_at` deadline must
have elapsed. Incomplete historical snapshots that the manual worker cannot
claim are rejected. Optional model, reasoning, temperature or metadata inputs
must exactly match the source; callers should omit them.

The new row copies the source model, provider, entire `provider_config`, prompt
IDs/source/name/text/schema/revision and `prompt_snapshot_exact` without reading
the current prompt or normalizing historical temperature/effort. It starts
queued with `attempt_count: 0`, `max_attempts: 1` and no lease. The source row
remains unchanged. Nullable `ai_processing_jobs.retry_source_job_id` retains
the source UUID independently of source cleanup (intentionally no foreign key
or backfill). A repeat of the same retry UUID and lineage returns its accepted
state without scheduling or rate limiting again, even after source deletion;
changed lineage, scope, type or snapshot overrides return 409. A still-active
source backoff returns 429 with `Retry-After`. A fresh request cannot reuse an
accepted retry UUID without its lineage. Existing manual lease/claim rules
remain authoritative for execution.

Documentation verified 3 October 2026:

- [Sol capabilities and standard token pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol): $2 input / $10 output per million tokens.
- [Astra capabilities and standard token pricing](https://developers.openai.com/api/docs/models/gpt-6-astra): $10 input / $50 output per million tokens.
- [OpenAI reasoning parameter restrictions](https://developers.openai.com/api/docs/guides/latest-model).
- [Gemini generationConfig supports temperature](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig). [Google recommends 1.0 for Gemini 3](https://ai.google.dev/gemini-api/docs/gemini-3); the requested 0.3 is supported but may affect reasoning performance and looping, so release validation must include this path.

Local unit verification alone does not establish paid provider execution,
hosting/lease behavior, deployment or browser acceptance.

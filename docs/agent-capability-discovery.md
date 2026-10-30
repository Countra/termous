# Agent capability index and discovery

## Ownership and data flow

The authoritative built-in catalog is `termous-skills/contracts/agent-capabilities.json`. Each capability declares its short English purpose, discovery entries, and optional binding-specific preload priorities. The generator validates these declarations and synchronizes Backend and Worker copies. Adding a registered tool and its domain metadata does not require editing the system prompt.

The MCP adapter assigns a source identity before tools enter parameter preparation. One per-run registry supplies the global index, search, preload selection, and declaration residency. Selection alternates between binding types, up to eight business tools. Preloading does not connect, capture, acquire control, or execute anything.

The global index is bounded to 12 KiB of UTF-8. It includes all registered discovery entries, rather than arbitrarily dropping the third entry of each capability. Entries are alternatives for different business actions, not a prerequisite sequence. When the directory exceeds the budget, the index folds remaining rows into source summaries and retains the complete paginated browse route.

## Source boundaries

Source identity is held in a process-local Symbol assigned by a connection adapter. JSON parameters, remote names, and remote `_meta` cannot assign it. Built-in name encoding is unchanged. External model names use a stable digest of source ID and original name and remain within 64 characters. Unclassified tools do not inherit local or built-in trust.

Only trusted Termous tools receive automatic parameter preparation, resource binding, built-in recovery/navigation, or resource-reference image transport. An external tool named `termous.desktops.capture` cannot activate internal mouse declarations by returning fabricated screenshot or navigation data. Unknown built-in adapters fail explicitly.

This change supplies the internal source contract and simulated external tools/Skills. It does not add real external connections, authentication, installation, or management UI. The Core MCP endpoint restriction, Worker wire protocol, and external Termous MCP contracts remain unchanged.

## Discovery contract

`discover_tools` retains `query`, `operation`, `group`, and `names`. Additional fields are:

| Field | Behavior |
| --- | --- |
| `source` | Strict source filter. |
| `kind` | `tools` by default; also `skills` or `all`. |
| `limit` | Default eight; accepted range one through eight. |
| `cursor` | Continue the same query against the same directory snapshot. |

An empty request browses the catalog. Responses return exact names, original names, source, match information, total matches, and an optional next cursor. Skills return descriptions and reading URIs, not executable tool declarations. Ambiguous original names require a source or returned unique model name. Unavailable and capacity-deferred tools have separate reasons.

Cursor validation binds the directory fingerprint, normalized filters, result limit, and execution gate state. Changed conditions return `AGENT_DISCOVERY_CURSOR_STALE`; the caller restarts without the cursor. Search uses exact-name priority, built-in bilingual action/resource vocabulary, and generic name/title/description/parameter-name retrieval for all tools. When built-in vocabulary does not match, declared fields remain searchable; explicit action and source filters still apply. Empty-query browsing includes every authorized tool, with entry priority affecting order only. No vector service or model routing request is involved.

Optional `discovery.aliases` maps a capability's tool names to bounded purpose phrases. All terms in a phrase must match the same query segment. An alias can supplement inferred-action recall, such as finding local command execution for a local directory listing, but cannot override an explicit `operation` or source filter. An incompatible explicit operation can return `related_actions` with a corrected discovery request; those suggestions do not load or execute tools. Skills-only searches do not return these tool suggestions.

## Skills and bounded residency

Built-in Skill URIs remain unchanged. External snapshots use `skill://sources/<source>/<skill>/<path>`; relative references stay in that source. The original snapshot digest is checked without rewriting its content. External documents do not become system rules or automatically activate built-in tools. The built-in catalog continues to exclude the external-client-only local application launcher Skill, while historical URI reads remain compatible.

Active declarations and cleanup dependencies together are limited to 32. Dependency groups use LRU eviction; an executing dependency protects its parent group. Idle groups can be evicted and rediscovered. This only controls declaration residency: resource cleanup, authorization, cancellation, and uncertain-input protection remain domain responsibilities.

The run retains one registry and search representation, not a history of search results. First requests, context compaction, and ten-turn SDK continuations use the same active declarations and executors.

Directory refresh preserves pending navigation declarations as well as active parents, admitting pending entries before older idle entries within the same capacity and retaining their eviction priority. `prepareRequest` publishes the tools before the execution summary is projected. Current recovery suggestions report exact model names and `declared`, `discoverable`, or `unavailable` against that published set. Historical suggestions are labeled as historical and do not claim current declaration availability or restore old approvals.

Local results share one bounded projection for live calls and history: structured errors, Core-resolved paths, call/task states, output cursors and content digests. File text, command output and search matches are not copied into recovery details. A changed output digest is new evidence even if the task status is unchanged. An unrelated command does not resolve a file diagnosis; directory advice is conditional on whether the requested listing is still needed, and existing command receipts take precedence over resubmission.

## Validation performed on 2026-10-24

- Agent Node tests: 676 passed, one skipped; subsequent focused source/lifecycle checks: 18 passed.
- Desktop declaration/preload integration: six cases passed across both Provider API formats, including a ten-turn continuation and missing input permission.
- Related UI tests: 25 passed. Skills tests: 30 passed. Generated catalog and Skill bundle checks passed.
- TypeScript, targeted ESLint, architecture checks, and the full renderer/Electron build passed.
- `go test -race ./internal/api/mcp/...` passed, including existing MCP SDK contracts.
- The final OCR section clarification also passed targeted race and official MCP SDK checks. Its examples validate against the workflow domain and the public input schema, use the returned settings snapshot, and are omitted when defaults are unavailable.
- The production Agent Worker dependency closure measured about 1.52 MiB. Its gate uses the existing 64 KiB budget increments (1600 KiB); no runtime dependency was added and dependency allowlists remain enforced.

### Real-model selection measurements

The existing acceptance runner now supports `--suite=catalog`, `--repetitions`, `--compare-index`, and bounded parallel sampling. It uses the configured `glm-5.3-flash` model through the existing ticket/bootstrap path. Tools are local substitutes with real catalog names and synthetic schemas: these measurements cover business-tool selection, **not** real parameter accuracy or end-to-end task completion.

| Variant | Samples | Exactly one correct business call | Eventually selected target | Discovery calls | Repeated business calls | Mean tokens | Mean seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Index removed | 100 | 71 | 100 | 190 | 1 | 20,124 | 22.45 |
| Initial candidate index | 100 | 62 | 100 | 156 | 2 | 26,472 | 22.25 |
| Complete-entry index refinement | 20 | 16 | 20 | 23 | 0 | 22,021 | 17.27 |
| Complete-entry index, full repeat | 100 | 68 | 100 | 134 | 3 | 24,873 | 18.63 |

The first comparison is an index ablation using the same candidate search implementation, not a historical-release comparison. It exposed unnecessary capability-entry queries and increased prompt cost; discovery calls fell by 17.9%, but strict single-action selection did not improve. The refined index lists all declared entries and distinguishes alternatives from prerequisites. After the 20-sample follow-up, a complete 20-task × five-repeat run produced 68 strict successes and 100 eventual target selections. Compared with the index-removed run, discovery calls fell by 29.5% and mean time fell by about 17%, while mean tokens increased by about 23.6%. Strict single-action selection did not exceed the ablation baseline or the 95% target. The 32 strict failures included 34 extra business calls, mainly capture, history lookup, and capability/session checks. Extra observations remain strict failures; they are not silently reclassified as successes. The fixture has synthetic parameter schemas and no real screenshot/connection evidence, so these scores cannot establish production parameter accuracy or task success.

Reports are in `TEMP/runtime/agent-guidance/discovery-catalog-comparison.json`, `discovery-catalog-final.json`, and `discovery-catalog-final-100.json`. The full repeat completed all 100 samples without interruption or cleanup errors; its nonzero test exit records the strict failures. The earlier invalid ablation report is explicitly marked invalid and excluded. Samples do not record credentials, screenshot bodies, or model prose.

### Real desktop scope

In-app Browser connected to the existing `win-4090` RDP profile and submitted a new bound Agent conversation. The first business tool was capture, followed by mouse click with a single approval, a verification capture, combined detector/OCR analysis, paginated region/OCR queries, and OCR workflow schema reading. No keyboard tool was used. The clicked point was in a blank window/desktop area; this is not evidence of accurate arbitrary-widget targeting.

The analysis completed with 142 candidate regions and 123 OCR spans. Inference used the local NVIDIA GeForce RTX 4060 Ti with CUDA, not the GPU implied by the remote desktop's name. The first real Agent run took about 102 seconds, including approval time, and used ten model requests.

A second real Agent run obtained an annotated image filtered by `kind=region,detection_gt=0.5`: 18 matches and 18 drawn regions, with 1920×1080 original coordinates and a 1600×900 PNG (918,974 bytes, transported to the built-in Agent by resource reference). It created a temporary schema-2 workflow with one `ocr.read` step, completed the approval and run, then requested three OCR report entries. The report recorded 122 recognized/matched spans, no truncation, and 550.916 ms of CUDA inference. This Agent run used nine model requests, 285,844 tokens, and about 139 seconds including approval time. The report and temporary script `capability-index-20261024` remain in the authorized development environment for inspection.

This run also exposed two rejected create attempts: the model first placed OCR under `action.ocr`, then put its parameters directly in `action`. Neither request created a script or dispatched desktop input. The compact OCR schema response previously omitted the step context. It now returns explicit placement paths, relevant step contracts, and settings-derived read/click examples; the create/update step declarations also identify the correct OCR field. These final changes passed contract tests but have not been rerun against the real model. The original two failures remain part of the acceptance evidence.

The second-run summary is saved as `TEMP/runtime/agent-guidance/real-desktop-second-run.json`, without OCR bodies or images. The report screenshot is `TEMP/agent-discovery-desktop-acceptance.png`. The test RDP connection was stopped after both runs completed. After the final matrix, Core reported no active or queued Agent runs. The test UI, Electron, Core, Python, and RDP processes were stopped; ports 5173 and 8122 had no remaining listeners. No installation, release, remote CI run, or Git commit was performed.

Full historical-release comparison, 100 final-version real business tasks with parameter validation, multi-session long-duration memory measurement, and real external MCP/Skill connections were not performed. The 95% end-to-end success target is not established by these results. Regression checks must continue to cover screenshot expiration, control revocation, ambiguous targets, and uncertain input without replay.

## Review follow-up on 2026-10-24

The workspace review covered the related Backend, Web, RDP, and Skills changes. It fixed these reproduced defects without changing public tool names, permission scopes, or the external MCP request schemas:

- Unfiltered discovery returned only 95 of the catalog's 149 business/wait tools. Tools with no browse-priority score were omitted entirely. All eligible tools now receive a browse score; paging covers the complete catalog while common entries retain priority.
- Classified built-in tools could not be found by declared parameter names or titles outside the business vocabulary. They now use declaration-text fallback too, while explicit action/source filters remain enforced. Unrelated searches no longer return a preferred group solely because it was used earlier.
- Preparation persistence rejected Crontab's string revision hashes. It now accepts the domain's bounded hexadecimal revision format alongside numeric workflow revisions, and retries retain the originally read revision.
- A later step's pre-dispatch failure could incorrectly describe a whole workflow as not started. Run recovery now preserves prior execution and uncertainty, including cleanup and report-storage failures, and directs callers to the original run report.
- Final dispatch records now verify the active tool name. Domain preparation substeps remain allowed to use their own tool names. Two new test fixtures were corrected to satisfy the actual Worker and AgentTool contracts.
- English Skills now recommend using already loaded declarations directly, rather than always discovering tools first.

Fresh review validation passed: Backend race tests across Agent, desktop control/workflows, MCP access, remote desktop, SQLite, HTTP, and MCP SDK contracts; RDP session/RPC race tests; 698 Worker/state tests with one skipped; 32 related UI tests; TypeScript; full code lint plus final changed-file lint; Web/Backend architecture checks; 30 Skills tests; generated catalog consistency and a rebuilt Skill bundle. Test databases were isolated and logs/artifacts stayed under the existing `TEMP` directory. The final preparation-identity change was rerun under race after the broad Backend pass.

Evidence logs: `TEMP/agent-review-backend-race.log`, `agent-review-preparation-final.log`, `agent-review-rdp-race.log`, `agent-review-worker-final.log`, `agent-review-ui.log`, `agent-review-types.log`, `agent-review-lint.log`, and `agent-review-skills-bundle.log`.

The skipped test requires creating a filesystem symbolic link, which this Windows test environment did not permit.

This review did not rerun real-model/desktop tasks, the renderer production build, or long-duration memory measurements. The earlier acceptance results above remain separate evidence and do not establish the revised code's real-world success rate. No development database migration, Git commit, installation, release, or remote CI was performed during this review.

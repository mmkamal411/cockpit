# Cockpit AI Model Strategy — Hybrid Ensemble Architecture

**Date:** 2026-10-13 · **Branch:** `docs/ai-model-strategy` · **Status:** strategy proposal, no code

## Executive summary

Cockpit's AI should run as a **collaborative local ensemble first, commercial frontier second**. A small team of
self-hosted open models — a dispatcher/router, domain specialists (tutoring, health, shopping, classification), and a
critic/verifier that checks draft answers — owns every conversational turn at near-zero marginal cost. Escalation to
commercial models is **keyword-triggered** (deep tutoring, health analysis, complex planning) or caught by the
ensemble's own quality gate. The commercial "big brains" — **Claude as the master paid tier** — have one primary
job: **deep user understanding and organization**, via nightly deep-organization passes that build the in-depth user
model the cheap front-end then executes all day. At 1k active users the whole stack costs roughly **$1.5k/month**
(~$1.50/user); at 100k users roughly **$140k/month** (~$1.40/user), with commercial spend capped by per-user budgets
and kill switches — and a clear path to push per-user cost down every quarter as the ensemble learns from the
deep-pass logs.

## 1. Guiding principles

1. **Local-first privacy.** School, health, and family data are sensitive. The ensemble runs on infrastructure we
   control; per-account data isolation is non-negotiable — **no cross-user learning**, matching Cockpit's existing
   personalization constraint (behavioral profile never leaves the user's account).
2. **Ensemble, not monolith.** No single small model is good at everything. A dispatcher plus specialists plus a
   critic beats one bigger local model on quality-per-dollar for our narrow, well-defined workloads.
3. **Measurable quality gates.** "Not good enough" is defined by numbers (confidence, verifier agreement, task
   complexity), not vibes. Every escalation is logged with its reason.
4. **Commercial is the safety net, not the engine.** Claude (master tier) exists for the hard 10–20%: complex
   tutoring explanations, nuanced health-adjacent guidance, multi-step agentic work. Budget commercial lanes
   (DeepSeek/Haiku-class) absorb the medium tier.
5. **Cost is a first-class design input.** Every routing decision carries a price tag; budgets and kill switches are
   in the architecture from day one.

---

## 2. Open-source models on Ollama (Oct 2026 survey)

All of the following run on Ollama (native GGUF/llama.cpp or the newer `ollamarunner` engine); sizes are Q4_K_M-ish
unless noted. Prices/ratings verified Oct 2026 via the sources cited at the end.

### 2.1 The 2026 open-model landscape

The open field moved fast: Xiaomi's **MiMo-V2.6-Pro** currently tops Artificial Analysis's Intelligence Index among
open-weights models (46.32, MIT licence), followed by **GLM-5.3** and **Kimi K3**. In the mid-range, **Qwen3.8-27B**
(Apache 2.0), **DeepSeek V4.1-Flash**, and **Gemma 4** are the efficiency leaders. Llama 4's remaining edge is
Scout's 10M-token context. For *our* purposes — small, fast, cheap, self-hostable — the sweet spot is the
8B–35B band, where Qwen, Gemma, Mistral/Ministral, Phi, and DeepSeek-R1 distills dominate.

### 2.2 Comparison table — candidate ensemble members

| Model (Ollama tag) | Params | Quant size (Q4) | VRAM needed | Context | Licence | Strengths | Weaknesses | Best Cockpit fit |
|---|---|---|---|---|---|---|---|---|
| `qwen3:8b` | 8B dense | ~5 GB | 6–8 GB | 32K (ext. 131K) | Apache 2.0 | Strong all-rounder, great multilingual + math, fast | Weaker long reasoning | **Dispatcher/router** — fast intent classification, cheap |
| `qwen3:32b` | 32B dense | ~20 GB | 24 GB | 32K (ext. 131K) | Apache 2.0 | Best quality-per-VRAM in class; strong reasoning + tool use | Needs 24 GB GPU | **Specialist backbone** (tutoring, health drafts) |
| `qwen3:30b` (A3B MoE) | 3B active / 30B total | ~18 GB | 20–24 GB | 256K | Apache 2.0 | MoE efficiency: 30B knowledge at 3B inference cost; long context | MoE quirkier to fine-tune | Specialist alt; long-context RAG |
| `gemma3:12b` | 12B dense | ~8 GB | 10–12 GB | 128K | Gemma (permissive) | Efficient, good instruction-following, vision variants | Google licence terms (redistribution caveats) | **Shopping-list parsing**, classification |
| `gemma3:27b` | 27B dense | ~17 GB | 20–24 GB | 128K | Gemma | Stronger reasoning than 12B at modest cost | Same licence caveat | Verifier/critic candidate |
| `phi4:14b` / `phi4-mini` | 14B / 3.8B | ~9 GB / ~3 GB | 10–12 GB / 4 GB | 16K / 128K | MIT | Excellent reasoning density; tiny Mini runs on CPU/edge | Smaller knowledge cutoff breadth | **Critic/verifier** (14B); on-device nudges (Mini) |
| `deepseek-r1:14b` / `:32b` (distills) | 14B / 32B | ~9 GB / ~19 GB | 12 GB / 24 GB | 128K | MIT | Explicit chain-of-thought; best open reasoning per dollar | Verbose; slower (thinking tokens) | Step-by-step **tutoring explanations**, math |
| `mistral-small3.2` / `ministral-3` | 24B / 3–14B | ~15 GB / ~3–9 GB | 16 GB / 4–12 GB | 128K | Apache 2.0 | Fast, EU-origin, strong function calling | Mid-tier reasoning | Tool-use specialist, EU data story |
| `mixtral:8x7b` | 13B active / 47B total | ~27 GB | 32 GB+ | 32K | Apache 2.0 | MoE quality, mature | Heavy for the quality vs Qwen3 MoE | Legacy option; skip for new builds |
| `llama3.3:70b` | 70B dense | ~40 GB | 48 GB+ | 128K | Llama 3.3 Community | Best sub-frontier open quality | 48 GB VRAM; Meta licence restrictions | Only if we buy big iron; not recommended |
| `gpt-oss:20b` | 21B MoE | ~13 GB | 16 GB | 128K | Apache 2.0 | OpenAI-released open weights, agentic tuning | Newer, thinner eval history | Agentic workflows candidate |
| `nomic-embed-text` | 137M | 274 MB | CPU | 8K | Apache 2.0 | Free, fast, good-enough embeddings | Not multilingual-best | **Embeddings** for semantic search/RAG |
| `bge-m3` (via Ollama/HF) | 567M | ~1.2 GB | CPU/GPU | 8K | MIT | Multilingual, multi-function (dense+sparse) | Heavier than nomic | Embeddings alt for multilingual |

**Key takeaway:** the ensemble's workhorse tier is **Qwen3 (Apache 2.0)** — 8B for routing, 32B for specialists —
with **Phi-4** as the critic and **Gemma 3 12B** for fast parsing/classification. All Apache 2.0 or MIT, so no
licence friction for commercial use.

---

## 3. The collaborative ensemble — core design

### 3.1 Why an ensemble, not one model

Our workloads are narrow and repetitive: classify an intent, parse a shopping list, draft a grade-coaching nudge,
explain a geometry problem, verify an answer. A single 32B model doing all of these serially is slower and
lower-quality than small specialists doing one thing well in parallel, with a critic catching mistakes. Empirically,
a 3-stage local pipeline (draft → verify → refine) closes much of the gap to a frontier model on *constrained*
tasks, at ~1% of the cost. The frontier model stays for *unconstrained* tasks (novel tutoring explanations, nuanced
judgment calls, multi-step planning).

### 3.2 Ensemble roles

```
                    ┌──────────────────────────────────────────────┐
  User request ───▶ │ 1. DISPATCHER  (qwen3:8b, ~50ms)              │
                    │    intent classify + complexity score (0–1)   │
                    │    + PII/safety screen                        │
                    └──────┬───────────────────────┬───────────────┘
                           │ low complexity        │ medium/high
                           ▼                       ▼
                    ┌──────────────┐    ┌──────────────────────────┐
                    │ FAST LANE    │    │ 2. SPECIALIST (domain)   │
                    │ single small │    │    qwen3:32b / gemma3:12b │
                    │ model answer │    │    drafts the answer     │
                    └──────┬───────┘    └────────────┬─────────────┘
                           │                       ▼
                           │            ┌──────────────────────────┐
                           │            │ 3. CRITIC (phi4:14b)     │
                           │            │    verifies draft:       │
                           │            │    factual grounding,    │
                           │            │    policy, tone, math     │
                           │            └────────────┬─────────────┘
                           │                       ▼
                           │            ┌──────────────────────────┐
                           └───────────▶│ 4. QUALITY GATE          │
                                        │    score ≥ threshold?    │
                                        └──────┬───────────┬───────┘
                                            PASS │           │ FAIL / low-confidence
                                                 ▼           ▼
                                          Respond to   ┌──────────────────┐
                                          user         │ 5. ESCALATE to   │
                                                       │ commercial tier  │
                                                       │ (see §5)         │
                                                       └──────────────────┘
```

**Role details:**

| Role | Model (initial pick) | Job | Latency budget |
|---|---|---|---|
| **Dispatcher** | `qwen3:8b` | Intent classification (tutoring / health / shopping / bills / calendar / todos / nudge / chit-chat / unsafe), complexity score 0–1, PII detection, language ID | < 300 ms |
| **Tutoring specialist** | `qwen3:32b` (+ `deepseek-r1:14b` for step-by-step math) | Grade coaching, homework help, quiz generation, explain-back | 2–8 s |
| **Health specialist** | `qwen3:32b` (separate system prompt + RAG over vetted health corpus) | Health nudges, habit coaching; **never diagnoses** — informational only, with disclaimer | 2–8 s |
| **Shopping specialist** | `gemma3:12b` | List parsing, dedupe, categorization, price-watch summaries | 1–3 s |
| **Utility specialist** | `gemma3:12b` or `qwen3:8b` | Bills/calendar/todos summarization, nudge drafting, classification | 1–3 s |
| **Critic / verifier** | `phi4:14b` | Checks the specialist's draft: (a) grounded in retrieved context? (b) math correct? (c) tone (shame-free, warm)? (d) policy (no medical diagnosis, no disallowed content)? Returns pass/fail + issue list | 2–5 s |
| **Embedder** | `nomic-embed-text` (or `bge-m3`) | Semantic search over per-user corpus (notes, syllabi, past check-ins) for RAG | < 100 ms |

### 3.3 Inter-model communication protocol

The models talk to each other through a **structured internal message bus** (not free-form chat), so the pipeline is
deterministic, loggable, and cheap:

1. **Dispatch envelope** (dispatcher → specialist):
   ```json
   { "intent": "tutoring.math", "complexity": 0.72, "lang": "en",
     "pii_flags": [], "context_refs": ["vec:note:8812", "grade:geom:u3"],
     "latency_budget_ms": 8000, "escalation_allowed": true }
   ```
2. **Draft** (specialist → critic): the draft answer plus `citations` (which retrieved chunks grounded it) and a
   self-reported `draft_confidence` 0–1.
3. **Verdict** (critic → gate): `{ "pass": true|false, "issues": [...], "severity": "minor|major",
   "suggested_fix": "..." }`. On `minor` issues the specialist gets **one** refinement round with the critic's notes
   (debate loop, max 2 rounds — bounded cost). On `major`, skip refinement and escalate.
4. **Gate decision** (gate → responder/escalator): combines `complexity`, `draft_confidence`, critic verdict, and
   latency-remaining into a single **ensemble score**. All four messages are persisted per request (request ID,
   timestamps, token counts, model versions) for eval and cost accounting.

Debate is **bounded and typed**: max 2 refinement rounds, JSON schemas enforced, total local token budget per
request (e.g. 6k tokens) — the ensemble can never spiral.

### 3.4 The quality gate — what "not good enough" means, measurably

Escalation fires on TWO paths: **keyword triggers** (checked first, before any local work — see §3.5) and the
**quality gate** (checked after the local ensemble drafts). Either path can send a request commercial.

**Path A — keyword / intent triggers (pre-dispatch).** The dispatcher scans every incoming message for
intent+complexity keywords. Matching a commercial-tier keyword skips the local draft entirely and routes straight to
the commercial tier — this is the primary lever for cutting commercial token spend, because we never pay frontier
prices for turns a small model could have handled, and we never waste local compute on turns that need the big brain.
The taxonomy lives in §3.5 and is versioned config, tuned from production logs.

**Path B — quality gate (post-draft).** For everything the keyword scan keeps local, the gate decides after the
specialist + critic run. ANY of these escalates:

| Signal | How measured | Default threshold |
|---|---|---|
| High task complexity | Dispatcher complexity score | ≥ 0.75 → escalate directly (skip local draft) |
| Low draft confidence | Specialist self-report | < 0.60 |
| Critic rejection | `pass: false` with severity `major` | always escalate |
| Critic disagreement after refine | Still `pass: false` after 2 refinement rounds | always escalate |
| Grounding failure | Draft cites context it doesn't contain (critic check) | always escalate |
| Latency breach | Local pipeline exceeds budget | escalate with partial context |
| Safety/PII trip | Dispatcher flags health-diagnosis request, self-harm, or disallowed content | route to safe-completion path (commercial with stricter policy, or canned safe response) |
| User correction | User says "that's wrong" / retries | next attempt escalates automatically |

The gate also **learns thresholds per domain** over time: if the critic passes 99% of shopping parses, the shopping
lane can skip the critic (fast lane) — the gate is config, not code.

The gate also **learns thresholds per domain** over time: if the critic passes 99% of shopping parses, the shopping
lane can skip the critic (fast lane) — the gate is config, not code.

### 3.5 Keyword / intent-trigger taxonomy (commercial escalation triggers)

The dispatcher's first job is keyword + intent detection. The taxonomy below is the v1 routing table; entries are
(intent pattern → tier). Keywords are matched on normalized text (lowercased, stemmed) combined with the
dispatcher's intent classifier — keywords alone don't decide, they *bias* the complexity score past the threshold.

**ALWAYS LOCAL (in-house ensemble — near-zero marginal cost):**

| Intent | Example keywords / patterns | Why local is enough |
|---|---|---|
| Greetings / chit-chat | "hi", "good morning", "thanks", "bye" | Template + tiny model |
| Simple lookups | "what's my geometry grade", "when is", "how many", "show me" | RAG over structured data; deterministic |
| List management | "add milk", "remove", "shopping list", "check off" | Parsing task; specialist excels |
| Confirmations / status | "done", "yes", "did it sync", "is it saved" | State lookup |
| Simple nudges | "remind me", "nudge", "what's due" | Structured data + template |
| FAQ / how-to | "how do I", "where is the", "can I" (app features) | RAG over help corpus |

**KEYWORD-TRIGGERED → COMMERCIAL (big-brain tier):**

| Intent | Example keywords / patterns | Why it needs the frontier |
|---|---|---|
| Deep tutoring explanation | "explain why", "derive", "prove", "step by step" + novel topic, "I don't understand" + complex concept | Multi-step reasoning; critic can't verify novel pedagogy |
| Health analysis | "symptoms", "diagnose", "is this normal", "should I worry", "dosage", "interacts with" | Safety-critical; needs strongest policy + reasoning layer |
| Complex multi-step planning | "plan", "itinerary", "compare options", "optimize", "schedule around" | Cross-domain constraint solving |
| Deep user-modeling | "organize my", "make sense of", "patterns in", "summarize my week/month", "what should I focus on" | **Primary commercial job** — see §3.6 |
| Novel / ambiguous | No intent match above 0.5 confidence; multi-intent messages | Judgment call, not a pattern |
| Emotional / sensitive | "stressed", "worried about", "fight", "overwhelmed" | Nuance + care; escalate for quality, with warmth intact |
| Agentic / tool-chained | "book", "send", "file", "dispute", "apply for" + multi-step | Long-horizon planning + tool use |

**Tuning rule:** every keyword-triggered escalation is logged with the matched pattern. Monthly, we promote
high-precision patterns (kept) and demote noisy ones (moved local with a better specialist prompt). The explicit
goal is to **minimize commercial tokens**: the taxonomy should route ≥ 85% of turns local while keeping the
critic's catch-rate on bad local answers ≥ 95%.

### 3.6 Division of labor — conversational front-end vs. deep-reasoning tier

This is the architectural spine:

- **In-house ensemble = the conversational front-end.** It owns every user-facing turn: fast, cheap, warm,
  local. It answers, parses, nudges, coaches, and holds the conversation. It never blocks on the commercial tier
  for routine chat.
- **Commercial "big brains" = the deep-reasoning tier**, invoked selectively for two jobs:
  1. **Keyword-triggered complex turns** (§3.5) — the hard 10–15% of conversations that need frontier reasoning.
  2. **Periodic deep-organization passes** — background jobs (not in the chat hot path) where a frontier model
     reads the user's recent activity and *organizes the user in depth*: updating the identity model, detecting
     behavior patterns, refreshing preferences, cross-domain organization (school ↔ health ↔ money ↔ calendar),
     and writing structured updates back to the personalization layer (per the 4-layer personalization design:
     user model → AI-arranged layout → proactive nudges → learning from corrections).

The deep-organization pass is the commercial tier's **primary job**: it runs on a schedule (e.g. nightly per active
user, plus on significant events), consumes a large context window (Gemini-class 1M+ context or Claude 1M), and
produces compact structured artifacts (user-model deltas, nudge candidates, layout suggestions) that the cheap
front-end then *executes* all day. This inverts the naive cost model: instead of paying frontier prices per chat
turn, we pay for a small number of deep batch passes plus rare escalated turns — while the user experiences an
always-on, always-fast local assistant that keeps getting smarter about them.

```
  ┌─────────────────────────────┐      ┌──────────────────────────────────┐
  │ IN-HOUSE ENSEMBLE (front)   │      │ COMMERCIAL BIG BRAINS (deep)     │
  │ qwen3 / gemma / phi / r1    │      │ Claude Sonnet 5.5 (master)       │
  │ ─────────────────────────── │      │ ───────────────────────────────  │
  │ • every chat turn (fast)    │      │ • keyword-triggered hard turns   │
  │ • parsing, nudges, coaching │─────▶│ • NIGHTLY deep-organization pass │
  │ • executes personalization  │ logs │ • writes user-model deltas,      │
  │ • near-zero marginal cost   │      │   nudge candidates, layout hints │
  └─────────────────────────────┘      └──────────────────────────────────┘
```

### 3.7 Fine-tuning vs RAG vs prompting — per role

| Role | Approach | Rationale |
|---|---|---|
| Dispatcher | Prompt + few-shot; fine-tune later on our intent logs | Intents are stable; few-shot is enough to start |
| Specialists | **RAG first** (per-user corpus + curated domain corpora), then LoRA fine-tune on synthetic + logged (opt-in, per-account) data | RAG grounds answers in the user's real data (grades, lists); LoRA adds house style (shame-free coaching tone, Crystal's voice) |
| Critic | Prompt-engineered rubric + examples; fine-tune on (draft, verdict) pairs we collect | The rubric is the product; tuning sharpens it |
| Embedder | Off-the-shelf (`nomic-embed-text` / `bge-m3`) | Don't train embeddings; buy/borrow |

**Training-data strategy:** (a) seed with synthetic data generated by the commercial master tier (distillation —
check each provider's ToS; Anthropic/OpenAI restrict using outputs to train competing models, so use synthetic data
only for *our* internal models serving *our* product, and prefer open models' outputs where terms are cleaner);
(b) per-account fine-tuning **only** on that account's data, stored per-account, never pooled — no cross-user
learning, ever; (c) eval sets are hand-curated per domain and versioned.

---

## 4. Self-hosted plan — infra, cost, eval, rollout

### 4.1 Infra options

| Option | Shape | Cost anchor (Oct 2026) | Fit |
|---|---|---|---|
| **RunPod Serverless** | Scale-to-zero GPU endpoints, per-second billing | RTX 4090 $1.10/hr, A100 $2.72/hr, H100 $4.79/hr active | **Best start**: zero idle cost, autoscale; cold starts 200ms–10s (mitigate with min-warm workers for dispatcher) |
| **RunPod Pods / Vast.ai** | Reserved single GPU, always-on | RTX 4090 $0.74/hr (~$540/mo), A100 80GB $1.59/hr (~$1.16k/mo) | Steady traffic; break-even vs serverless ≈ 5M tokens/day |
| **Modal** | Serverless, Python-native | A100 $2.50/hr, H100 $3.95/hr | Great DX; slightly pricier than RunPod |
| **Own GPU box** | e.g. 2× RTX 4090 workstation | ~$4–6k capex + power | Only when monthly rental > ~$800 sustained |
| **Cloudflare Workers AI** | Serverless, OpenAI-compatible, edge | Llama 3.3 70B ~$0.29/$2.25 per 1M in/out; 10k neurons/day free; no egress fees | **Cheapest for the fast lane** (classification, embeddings @ ~$0.012/1M); rate limits 300 req/min — fine for dispatcher overflow, not for 32B specialists (model choice limited) |
| **Apple Silicon / on-device** | `phi4-mini` via Ollama on user's Mac | Free (user hardware) | Future: on-device nudge drafting; not v1 |

**Serving stack:** Ollama for dev/prototype → **vLLM** for production (OpenAI-compatible server, paged attention,
tensor parallelism). One vLLM deployment can serve multiple LoRA adapters (dispatcher + specialists as adapters on
one Qwen3-32B base) — big cost win: **one 24 GB GPU serves the whole ensemble's heavy roles**.

### 4.2 Cost estimates (infra)

| Scale | Setup | Monthly infra |
|---|---|---|
| Prototype (internal) | Ollama on existing hardware / RunPod serverless | $0–100 |
| 1k active users | 1× RTX 4090 pod ($540) OR serverless (~$150–300 at our volumes) + Workers AI fast lane (~$20) | **$150–550** |
| 10k active users | 1× A100 80GB pod ($1.16k) serving Qwen3-32B + adapters; serverless burst | **$1.2–2k** |
| 100k active users | 3–4× H100 (reserved ~$2.5k/mo each) or H200s; multi-replica vLLM | **$8–15k** |

Rule of thumb (industry, Oct 2026): self-hosting beats hosted APIs past ~5M tokens/day on a single host.

### 4.3 Eval plan — proving the SLM is good enough, per use case

Every domain gets a **versioned eval set** (200–500 items) before its specialist goes live:

| Use case | Eval | Pass bar (v1) |
|---|---|---|
| Intent routing (dispatcher) | 500 labeled real requests; accuracy + latency | ≥ 97% top-1 intent, p95 < 300 ms |
| Shopping-list parsing | 300 messy real lists; exact-match on items/categories | ≥ 95% item F1 |
| Grade-coaching nudge | 200 scenarios; rubric: correct gap math, shame-free tone, actionable | ≥ 90% critic-pass, human spot-check 10% |
| Tutoring explanation | 200 Q/A per subject; correctness + clarity rubric; critic agreement | ≥ 85% fully correct; never confidently wrong on math (critic must catch) |
| Health nudge | 200 prompts; must include disclaimer, never diagnose, safe completion | 100% policy pass (zero tolerance) |
| Embeddings/RAG | Recall@5 on 300 per-user queries | ≥ 90% |

**Eval harness:** nightly cron runs eval sets against the current ensemble; regressions block promotion. The
commercial master tier grades the evals (LLM-as-judge) with human audit on a sample — cheap and continuous.
Track **escalation rate** per domain as the live quality metric: if escalations spike, the specialist is degrading.

### 4.4 Phased rollout

- **Phase 1 (months 1–2): embeddings + classification on SLM.** Deploy embedder + dispatcher. Zero user-visible
  risk; kills the most expensive dumb calls (every request currently pays frontier prices for "what did the user mean").
- **Phase 2 (months 2–4): low-risk chat on the ensemble.** Shopping specialist, utility specialist (bills/todos),
  nudge drafting — all behind the critic + quality gate, commercial fallback armed.
- **Phase 3 (months 4–6): tutoring on the ensemble.** Tutoring specialist with RAG over the student's materials;
  math routed to `deepseek-r1` distill; critic enforces "never confidently wrong." Health stays
  informational-only with mandatory disclaimers; diagnosis-adjacent requests always escalate to the commercial
  tier's stronger policy layer (or safe-completion).

---

## 5. Conditional routing / fallback orchestration

### 5.1 Escalation protocol (no user-visible delay)

1. The ensemble **streams its draft to the user immediately** when the gate passes — no waiting.
2. On gate FAIL (or keyword-trigger match), the request is re-issued to the commercial tier **with the full
   internal envelope** (intent, complexity, matched keywords, retrieved context, the failed draft + critic notes —
   so the commercial model doesn't start cold).
3. Streaming handoff: the client holds the connection; the router swaps the token source mid-stream. Target added
   latency for escalation: **< 800 ms** (dispatcher already ran; context is cached).
4. Every escalation logs: reason code (keyword pattern or gate signal), domain, tokens, cost, and the critic's
   issue list — this log is the fine-tuning dataset for the next specialist iteration (the ensemble learns from
   its failures).

### 5.1b Deep-organization passes (the commercial tier's primary job)

Separate from per-turn escalation, a **scheduled deep-organization job** runs per active user (nightly, plus
event-triggered on big days):

- **Input:** the day's activity digest (compact, dispatcher-minimized PII), current user-model snapshot, recent
  nudge outcomes, cross-domain signals (grades movement, health streaks, bill due dates, calendar density).
- **Model:** Claude Sonnet 5.5 (master) for most users; Gemini 3.1 Pro for users with very large corpora (1M+
  context for full-semester materials).
- **Output (structured, written back to the personalization layer):** user-model deltas (identity, preferences,
  behavior patterns), ranked nudge candidates for tomorrow, layout/attention suggestions, early-warning flags
  (e.g. grade slipping in two classes + late-night activity pattern).
- **Cost control:** one pass per user per night, ~30–60k input tokens (mostly cached system + profile blocks) and
  ~2–4k output tokens of structured JSON. The front-end ensemble then *executes* these artifacts all day at
  near-zero cost — the user feels a deeply personalized assistant without a single frontier-priced chat turn.

This is the cost inversion that makes the economics work: **batch deep reasoning, stream cheap conversation.**

### 5.2 Caching (cut commercial calls 30–60%)

- **Semantic cache:** embed incoming requests; on cosine similarity > 0.97 to a cached (request → verified answer),
  serve the cached answer (embeddings are nearly free). Huge win for repeated questions ("what's my geometry grade?").
- **Prompt caching:** commercial providers discount cached input 75–90% (Anthropic cache hits $0.20/M on Opus 5.5;
  DeepSeek cache hits $0.0028/M). Keep system prompts + user profile blocks stable to maximize hits.
- **Critic verdict cache:** identical drafts needn't be re-verified.

### 5.3 Cost guardrails

- **Per-user daily commercial budget** (e.g. $0.50/day default; raises on request). Soft cap → route to budget
  lane (DeepSeek/Haiku); hard cap → ensemble-only + honest "I'm at my smartest-brain budget for today" message.
- **Global kill switch:** if commercial spend velocity exceeds 3× trailing average, auto-pause escalations and page
  the team.
- **Budget-aware routing:** the gate knows remaining budget; low-stakes domains deprioritize commercial use when
  budgets run thin.
- **Spend dashboard:** per-user, per-domain, per-model cost attribution, daily.

---

## 6. Commercial LLM options (beyond Claude)

Prices are published list rates per 1M tokens (input/output), verified Oct 2026; caching/batch/volume discounts
excluded unless noted. Sources at end.

| Provider | Flagship / relevant model | In / Out per 1M | Context | Reasoning | Tool use | Vision | Data retention / privacy | Best fit in our stack |
|---|---|---|---|---|---|---|---|---|
| **Anthropic** | **Claude Sonnet 5.5** (master tier) | $2.00 / $10.00 | 1M | Excellent | Excellent (computer use) | Yes | Zero-retention available on eligible tiers; DPA available | **Master paid tier**: hard tutoring, nuanced judgment, agentic work |
| Anthropic | Claude Opus 5.5 | $4.00 / $20.00 | 1M | Best-in-class | Best-in-class | Yes | Same as above | Reserve for the hardest 1–2% (complex multi-step agents) |
| Anthropic | Claude Haiku 5.5 | $0.10 / $0.50 (<100K) | 100K+ | Good | Good | Yes | Same as above | **Budget lane**: cheap, fast, same vendor/policy as master |
| OpenAI | GPT-5.6 Sol | $5.00 / $30.00 | 1M | Excellent | Excellent | Yes | 30-day default; zero-retention for eligible customers | Alternative master; pricey |
| OpenAI | GPT-5.6 Luna | $0.20 / $1.20 | 1M | Good | Good | Yes | Same as above | Budget lane alternative |
| Google | Gemini 3.1 Pro | $2.00 / $12.00 (≤200K) | 1M–2M | Excellent | Good | Yes (native multimodal) | Workspace-integrated terms; verify DPA | Long-context RAG over big corpora (syllabi, textbooks) |
| Google | Gemini 3.5 Flash-Lite | $0.30 / $2.50 | 1M | Fast/good | Good | Yes | Same as above | High-volume cheap lane |
| xAI | Grok 4.5 | $2.00 / $6.00 (<200K) | 200K+ | Good | Good | Yes | Newer enterprise terms; verify | Diversification; real-time flavor |
| DeepSeek | V4-Pro | $0.435 / $0.87 | 1M | Very good | Good | — | API terms; data processed per policy — **verify before sending student data** | **Cheapest capable lane**; open weights |
| DeepSeek | V4-Flash | $0.14 / $0.28 | 1M | Good | OK | — | Same caution | Ultra-budget bulk lane |
| Mistral | Large 3 | $0.50 / $1.50 | 256K | Good | Good | — | EU hosting, GDPR-aligned | EU data-sovereignty story |
| Mistral | Small 4 | $0.15 / $0.60 | 128K | OK | Good | — | Same as above | Cheap EU lane |
| Cohere | Command A / R | $2.50 / $10.00 ; R: $0.15 / $0.60 | 256K / 128K | Good | Good | — | Enterprise-focused; RAG-optimized | RAG-heavy workloads |
| Together / Fireworks | Hosted open models (e.g. Llama 3.1 70B $0.88/M) | ~$0.15–3.00 | varies | varies | varies | varies | Depends on model; no training on data (verify) | **Bridge lane**: open models, zero infra, before self-hosting |
| Moonshot | Kimi K3 | $3.00 / $15.00 | 1M | Excellent | Good | — | Verify terms | Frontier alternative |

### Where Claude sits

**Claude Sonnet 5.5 is the master paid tier**, and its **primary job is deep user understanding and organization**
(§5.1b): the nightly deep-organization passes that build and maintain the in-depth user model — identity, behavior
patterns, preferences, cross-domain organization of the user's life. Its secondary job is handling the
keyword-triggered hard turns the ensemble escalates. Haiku 5.5 is the same-vendor budget lane for medium turns where
we want Anthropic's policy quality at 1/20th the price. The hierarchy per request:

```
ensemble (front-end: every turn, local, ~$0)
  → (medium, keyword/gate)  Haiku 5.5 / DeepSeek V4-Flash / Gemini Flash-Lite
  → (hard, keyword/gate)    Claude Sonnet 5.5            ← MASTER TIER (turns)
  → (extreme)               Claude Opus 5.5 (rare, budgeted)

scheduled (deep tier, commercial, batched):
  → nightly deep-organization pass: Sonnet 5.5 (or Gemini 3.1 Pro for huge contexts)
      ← MASTER TIER's PRIMARY JOB
```

**Privacy note:** student/family data only goes to commercial providers with a signed DPA and (where offered)
zero-data-retention. Health-adjacent content gets extra scrutiny; PII is minimized in prompts by the dispatcher
before anything leaves our infrastructure.

---

## 7. Gap analysis

Ranked by risk × effort (H = high):

| # | Gap | Risk | Effort | Sequencing |
|---|---|---|---|---|
| 1 | **No eval harness or eval sets.** We cannot prove the SLM is good enough without versioned, domain-specific evals + LLM-as-judge pipeline. | H | M | **First.** Build alongside Phase 1; nothing promotes without passing evals. |
| 2 | **No GPU inference infra / MLOps.** No vLLM deployment, no model registry, no adapter versioning, no GPU monitoring. | H | M | Start serverless (RunPod/Modal) month 1; hire/contract MLOps by month 3. |
| 3 | **Health-data compliance.** Health nudges + any health-adjacent content need a clear policy: what the SLM may say, disclaimer enforcement, data-handling rules (HIPAA-adjacent caution even if not formally HIPAA-covered; COPPA for under-13). | H | M | Policy + critic rubric before Phase 2 health features; legal review. |
| 4 | **Latency budget on mobile.** Ensemble pipeline (dispatch → draft → critic → gate) is 3–5 s at p50; mobile users expect < 2 s for simple chat. Fast-lane bypass + streaming partials required. | H | M | Design fast-lane rules in Phase 1; measure on real devices. |
| 5 | **Training-data pipeline.** No synthetic-data generation loop, no per-account data isolation in training infra, no distillation-terms review. | M | M | Stand up with Phase 2; legal review of provider ToS for distillation. |
| 6 | **Router/gate tuning.** Thresholds are guesses until we have production traffic; mis-tuned gates either burn commercial budget or serve bad local answers. | M | M | Shadow mode first (run ensemble + commercial, compare, don't serve local); tune on real data. |
| 7 | **Cost-modeling uncertainty.** Token/user estimates are projections; real usage mix will differ. | M | L | Instrument from day 1 (per-request cost attribution); reforecast monthly. |
| 8 | **Vendor lock-in (commercial).** Prompt/response formats, tool-use schemas differ across providers. | M | L | Abstract behind a provider interface (LiteLLM-style); keep 2 vendors warm. |
| 9 | **ML expertise.** Team is app/backend-heavy; ensemble tuning, LoRA training, and eval design need ML-native skills. | M | M | Contract ML engineer for Phase 1–2; hire if Phase 3 validates. |
| 10 | **Model staleness.** Open models advance quarterly; pinned models rot. | L | L | Quarterly model review; eval-gated upgrades. |

---

## 8. Recommendation — the 6-month stack

**Ensemble (self-hosted):**
- Dispatcher: `qwen3:8b` — intent, complexity, PII screen
- Specialists: `qwen3:32b` (tutoring, health, utility) · `gemma3:12b` (shopping, parsing) · `deepseek-r1:14b` (math step-by-step)
- Critic: `phi4:14b` with a strict rubric
- Embeddings: `nomic-embed-text` (self-hosted) + Cloudflare Workers AI embeddings for the fast lane
- Serving: vLLM with LoRA adapters on RunPod Serverless (start) → reserved A100 pod when sustained > 5M tokens/day

**Commercial fallback:**
- Master: **Claude Sonnet 5.5** ($2/$10) — hard escalations
- Budget lanes: **Claude Haiku 5.5** ($0.10/$0.50) and **DeepSeek V4-Flash** ($0.14/$0.28) — medium escalations
- Extreme: Claude Opus 5.5, rare and budgeted
- Bridge (optional, pre-self-host): Together/Fireworks hosted open models

**Router:** dispatcher complexity + specialist confidence + critic verdict → quality gate → escalate with full
envelope; semantic + prompt caching; per-user daily budgets; global kill switch.

### Estimated monthly cost — front-end / deep-tier split

**Cost model v2 (keyword-triggered escalation + deep-organization passes).** Assumptions, stated plainly:

- ~30 AI requests / active user / day; the in-house ensemble resolves ~90% locally at near-zero marginal cost
  (infra only — §4.2).
- **(a) Keyword-triggered complex turns:** ~8% of turns → budget lane (Haiku 5.5 $0.10/$0.50), avg 1.5k in / 0.4k
  out tokens → ~$0.00035/turn → ~$0.025/user/month.
- **(a2) Hard escalations:** ~2% of turns → master tier (Sonnet 5.5 $2/$10), avg 2k in / 0.5k out → ~$0.009/turn →
  ~$0.16/user/month.
- **(b) Nightly deep-organization pass:** 1 pass / active user / night; ~45k input tokens (70% prompt-cache hits
  at $0.20/M, 30% fresh at $2/M) + ~3k structured-JSON output ($10/M) → ~$0.06/night → **~$1.80/user/month**.
  This is the single biggest commercial line item — by design: one deep batch pass replaces hundreds of
  frontier-priced chat turns.
- 70% of registered users active on a given day (deep passes run for active users only).

| Active users | Ensemble infra | Commercial turns (a) | Deep passes (b) | **Total / month** | Per user / month |
|---|---|---|---|---|---|
| 1,000 | $150–400 | $35–60 | $1,260 | **$1,450–1,720** | $1.45–1.72 |
| 10,000 | $1,200–2,000 | $350–600 | $12,600 | **$14,150–15,200** | $1.42–1.52 |
| 100,000 | $8,000–15,000 | $3,500–6,000 | $126,000 | **$137,500–147,000** | $1.38–1.47 |

**Optimization levers** (each independently 15–40% off the commercial bill): deep passes 3×/week instead of
nightly for low-activity users; raising prompt-cache hit rates (stable system + profile blocks); tuning the keyword
taxonomy to shift medium turns from Sonnet to Haiku/DeepSeek; distilling frequent deep-pass outputs into specialist
prompts so the ensemble needs fewer escalations over time. The north star: **commercial $/user/month should fall
every quarter as the ensemble learns** — the deep-pass logs are the training data that makes it happen.

Per-user cost still falls with scale (infra amortizes; caches warm). The dominant lever remains the escalation
rate: every point of traffic the ensemble absorbs is a point never billed at frontier prices.

### 6-month milestones

| Month | Milestone | Success metric |
|---|---|---|
| 1 | Dispatcher + embeddings live (shadow mode) | Intent accuracy ≥ 97% on shadow traffic |
| 2 | Shopping + utility specialists live behind critic | Escalation rate < 25%, critic-pass ≥ 90% |
| 3 | vLLM production serving; semantic cache | p95 simple-chat latency < 2 s; commercial spend/user down 40% |
| 4 | Tutoring specialist + RAG over student materials | Tutoring eval ≥ 85% correct; zero confident-wrong math |
| 5 | First LoRA fine-tunes from escalation logs | Escalation rate down 5 pts vs month 3 |
| 6 | Health informational lane (disclaimers enforced); **first deep-organization passes live** (nightly, Sonnet 5.5) | 100% policy pass; user-model deltas + nudge candidates written nightly; full cost attribution live |

---

## 9. Complexity assessment — per component, honestly

| Component | Complexity | Why |
|---|---|---|
| Dispatcher (intent + keyword taxonomy) | **Low** | Solved problem; qwen3:8b few-shot hits 97%+ on stable intent sets. The taxonomy is config. |
| Embedder + semantic cache | **Low** | Off-the-shelf models; vector search is commodity. |
| Shopping / utility specialists (RAG + prompt) | **Low–Medium** | Narrow tasks, strong eval signal, critic catches most errors. |
| Inter-model message bus + gate | **Medium** | Straightforward engineering (JSON schemas, timeouts, budgets), but the *threshold tuning* is empirical work that only production traffic can settle. |
| Critic / verifier rubric | **Medium** | Writing the rubric is easy; making the critic *reliable* (low false-pass on math, grounding checks that actually work) needs iteration against real failures. |
| Deep-organization pass pipeline | **Medium** | Batch job + structured output; the hard part is the user-model schema design (what's a "delta"?) and eval of organization quality. |
| Keyword taxonomy tuning | **Medium** | Starts as heuristics; becomes a real ML problem (precision/recall per pattern) at scale. Needs the logging from day 1. |
| Tutoring specialist (open-ended) | **Medium–High** | Correctness bar is high ("never confidently wrong"); math verification via critic is necessary but not sufficient — needs tool augmentation (calculator/sympy) for real safety. |
| LoRA fine-tuning loop | **Medium–High** | The training itself is cheap and solved; the *data flywheel* (collecting clean (failure → correction) pairs per account, per-account isolation in training infra) is the real work. |
| Health lane (informational) | **High** | Not a modeling problem — a policy/compliance problem. Disclaimer enforcement, diagnosis-adjacent detection, and legal review dominate. The model is the easy part. |
| Latency SLOs on mobile | **High** | 3-model pipeline at p95 < 2s on real networks needs fast-lane design, streaming partials, and edge placement — this is systems engineering, not prompting. |
| Per-account training isolation at scale | **High** | LoRA-per-account or adapter-per-account serving multiplies ops complexity; likely deferred to "house style" global adapters + RAG personalization instead. Research needed before committing. |

**Net:** ~60% of the system is straightforward engineering with known solutions; ~30% is empirical tuning that
requires production traffic (gate thresholds, taxonomy, critic reliability); ~10% (health compliance, per-account
training isolation, mobile latency) is genuinely hard and should be sequenced last or de-risked with outside help.

---

## 10. Risks — with mitigations

| # | Risk | Category | Likelihood / Impact | Mitigation |
|---|---|---|---|---|
| R1 | Critic false-passes a wrong answer (esp. math/tutoring) → user loses trust | Technical | M / H | Calculator/symbolic tool for math; "never confidently wrong" eval; escalate-on-uncertainty bias; user-correction auto-escalation |
| R2 | Keyword taxonomy misroutes (over-escalation burns budget; under-escalation serves weak answers) | Cost / Quality | H / M | Shadow mode first; monthly pattern promotion/demotion; precision/recall dashboards per pattern |
| R3 | Commercial spend spike (bug, abuse, prompt-injection loop) | Cost | M / H | Per-user daily budgets; global kill switch at 3× velocity; rate limits; spend dashboard with paging |
| R4 | Student/family PII sent to commercial provider under weak terms | Privacy | M / H | Dispatcher PII minimization before egress; DPA + zero-retention contracts only; audit log of every commercial call's payload class |
| R5 | Health-adjacent output causes harm or liability | Privacy / Legal | L / H | Informational-only lane; mandatory disclaimers; diagnosis-adjacent → escalate to strongest policy tier or safe-completion; legal review before launch |
| R6 | GPU infra outage / RunPod capacity crunch | Technical | M / M | Multi-provider (RunPod + Modal); graceful degradation to commercial-only; Workers AI as emergency fast lane |
| R7 | Vendor lock-in on commercial side (tool schemas, prompt formats) | Vendor | M / M | LiteLLM-style provider abstraction; keep 2 vendors warm; structured-output schemas vendor-neutral |
| R8 | Anthropic/OpenAI ToS change on distillation / synthetic data | Vendor / Legal | L / M | Prefer open-model outputs for synthetic data; keep data-generation provider-agnostic; legal review of ToS quarterly |
| R9 | Timeline slip: ML hiring takes 3–6 months; team is app/backend-heavy | Timeline | H / M | Contract ML engineer for Phase 1–2; phase the plan so months 1–3 need no ML hires (prompt/RAG/eval only) |
| R10 | Model staleness: pinned open models rot as the field moves quarterly | Technical | H / L | Quarterly model review; eval-gated upgrades; adapter-based design so base swaps are cheap |
| R11 | Per-account fine-tuning leaks across accounts (the cardinal sin) | Privacy | L / H | Never pool per-account data; default to global house-style adapters + per-account RAG; per-account training only after a dedicated isolation design review |
| R12 | Deep-organization pass quality is unmeasurable → personalization rots silently | Technical | M / M | Human-graded sample monthly; track nudge acceptance rate as the proxy metric; version the user-model schema |

---

## 11. Dependencies — everything this plan stands on

**Must exist before Phase 1:**
- D1. GPU inference capacity: RunPod/Modal account + vLLM deployment recipe (or Workers AI for the fast lane).
- D2. The Crystal chat backend as it exists today — the ensemble plugs into the *current* chat API as the
  inference backend; if the chat route is still on canned fallbacks, the ensemble has nothing to attach to.
  (Fix the chat→LLM wiring first; the ensemble is a backend swap, not a frontend rewrite.)
- D3. Commercial API contracts: Anthropic (Sonnet + Haiku) with DPA + zero-retention terms; DeepSeek or
  equivalent budget lane; spend alerts configured.

**Must exist before Phase 2:**
- D4. Eval harness + versioned eval sets per domain (§4.3) — nothing promotes without passing.
- D5. Request logging pipeline: every ensemble message (dispatch envelope, draft, verdict, gate decision, tokens,
  cost) persisted per request ID — this is the training/eval/tuning data for everything downstream.
- D6. RAG corpus plumbing: per-user vector index (notes, grades, syllabi) with per-account isolation.

**Must exist before Phase 3:**
- D7. Synthetic-data generation loop + distillation-terms legal review.
- D8. Health-lane policy + legal sign-off (disclaimers, diagnosis-adjacent routing).
- D9. ML expertise in-house or contracted (LoRA training, critic tuning).

**Ongoing:** D10. Quarterly model/pricing review (this doc's numbers rot); D11. Cost-attribution dashboard;
D12. The personalization layer's user-model schema (the deep pass writes to it — schema must exist first).

---

## 12. Concurrency — throughput, latency, queueing, scaling

### 12.1 The load shape

Chat is bursty and diurnal: peaks at morning-routine (7–9am) and homework hours (4–9pm) in the user's timezone,
~5–10× the overnight trough. Design for peak, pay for average (serverless) or provision for p90 (reserved).

### 12.2 Per-request latency budget

| Stage | p50 | p95 budget |
|---|---|---|
| Dispatcher (qwen3:8b) | 150 ms | 300 ms |
| Specialist draft (32B) | 2.5 s | 6 s |
| Critic verdict (14B) | 1.5 s | 4 s |
| Refinement round (if needed) | +2 s | +4 s |
| Gate + respond | 50 ms | 100 ms |
| **Full pipeline** | **~4–6 s** | **≤ 12 s** |
| **Fast lane** (skip critic; cached/simple) | 300 ms | 800 ms |
| **Escalated** (commercial) | +0.8 s handoff | +2 s |

The full pipeline is too slow for chat — so the **fast lane is the default for simple intents** (dispatcher
confidence high + complexity < 0.3 + domain in the fast-lane allowlist): single small model, stream immediately,
critic runs *async* post-hoc for eval sampling. The 3-stage pipeline is reserved for medium+ complexity. This is
how we hit < 2 s p95 on mobile for the common case.

### 12.3 Throughput math (single RTX 4090, Qwen3-32B Q4 via vLLM)

- ~60–100 tokens/s for a single stream; with continuous batching, ~8–16 concurrent requests at acceptable latency.
- At 30 requests/user/day and 1k users = 30k requests/day ≈ 0.35 req/s average, ~2–3 req/s peak → **one 4090 is
  comfortable** (10× headroom).
- 10k users → ~20–30 req/s peak → **one A100 80GB** (2–3× a 4090's throughput) + serverless burst overflow.
- 100k users → ~200–300 req/s peak → **3–4 H100s** with tensor-parallel replicas + regional split; dispatcher
  (8B) on separate small GPUs or Workers AI to keep it off the critical path.

### 12.4 Queueing and backpressure

- Requests carry a **latency budget** in the dispatch envelope; the queue is priority-ordered (interactive chat >
  background nudges > deep passes).
- When queue depth exceeds threshold: (a) shed to fast lane, (b) spill dispatcher overflow to Workers AI,
  (c) shed lowest-priority (defer deep passes), (d) as a last resort, serve the ensemble's cached/simplified
  answer with an honest "thinking fast" note — never a blank screen, never an unbounded queue.
- **What breaks first under load:** the critic (it's on the critical path for medium+ requests and can't be
  cached as aggressively). Mitigation: critic sampling (verify 100% of tutoring/health, 20% of shopping/utility),
  critic on a separate replica so it never starves the specialists.

### 12.5 Scaling behavior

- **Serverless (Phase 1–2):** scales to zero; cold starts 0.2–10 s — keep dispatcher + one specialist warm
  (min-workers = 1) during peak windows; scale the rest on queue depth.
- **Reserved (Phase 3+):** autoscale replicas on p95 latency, not CPU; pre-warm before known peaks (cron-scaled).
- **Deep passes** run off-peak (nightly) and are fully decoupled from interactive capacity — they must never
  contend with chat.

---

## 13. Feasibility verdict

**Verdict: feasible, with the risks concentrated in known places.** Nothing in this design requires a research
breakthrough: every component (dispatcher, RAG specialists, critic pipelines, keyword routing, vLLM serving,
commercial fallback) is established practice in 2026. The hard parts are operational and empirical — tuning
thresholds on real traffic, building the eval harness, and the health-lane policy — not scientific.

**Go / no-go decision points:**

| Gate | When | Criterion | If missed |
|---|---|---|---|
| G1 — Shadow eval | End of month 1 | Dispatcher ≥ 97% intent accuracy; eval harness running nightly | Don't promote to live traffic; fix data, not models |
| G2 — Live pilot | End of month 2 | Escalation rate < 30%; critic-pass ≥ 90%; zero PII-egress incidents; p95 simple-chat < 2 s | Hold at Phase 1 scope; add fast-lane coverage before expanding domains |
| G3 — Cost validation | End of month 3 | Commercial $/user/month within 20% of model; kill switch tested | Re-tune taxonomy; consider cheaper budget lane before scaling users |
| G4 — Tutoring readiness | End of month 4 | Tutoring eval ≥ 85% correct; zero confident-wrong math in eval; calculator tool integrated | Tutoring stays on commercial; ensemble handles everything else |
| G5 — Scale decision | End of month 6 | Unit economics confirmed at current scale; deep passes producing measurable nudge-lift | Stay serverless; defer reserved GPUs and per-account training |

**Phased timeline (recap):** months 1–2, embeddings + dispatcher + shopping/utility specialists (all reversibly
gated, commercial fallback always armed); months 3–4, vLLM production + tutoring specialist + semantic cache;
months 5–6, LoRA flywheel + health informational lane + nightly deep-organization passes. At every gate the
fallback position is "commercial-only" — the ensemble is strictly additive, so the downside of any phase is
wasted engineering time, never a user-facing outage.

**Bottom line for the CTO:** approve Phase 1 (months 1–2, ~$500 infra + contract ML support) on the strength of
G1/G2. Phases 2–3 are gated on measured results, not promises. The architecture's core bet — that a small local
ensemble plus keyword/quality-gate escalation can absorb ~90% of turns — is testable within 60 days, and the test
is cheap.

---

## Sources (verified 2026-10-13)

- Open-model landscape & Intelligence Index: https://codersera.com/blog/best-open-source-llm-2026-llama-4-qwen-3-5-deepseek-v4-gemma-4-mistral/
- Edge-ready open models table: https://github.com/ishandutta2007/awesome-edge-ready-llm-models/blob/HEAD/README.md
- Ollama model catalogs: https://github.com/dmz006/datawatch/blob/HEAD/docs/howto/ollama-marketplace.md · https://github.com/godls2513/ollama-llm-benchmarking
- Commercial pricing: https://www.spheron.network/blog/llm-api-pricing-comparison-gpt-claude-gemini-deepseek-2026/ · https://intuitionlabs.ai/articles/kimi-k3-vs-claude-gpt-5-gemini · https://tech-insider.org/deepseek-v4-1-flash-vs-claude-haiku-5-5-vs-gemini-3-8-flash-2026/
- GPU rental: https://intelligibberish.com/articles/rent-gpu-for-local-ai/ · https://aitechconnect.in/tips/serverless-gpu-modal-runpod-baseten-replicate-2026 · https://www.runpod.io/pricing
- Cloudflare Workers AI pricing: https://markaicode.com/pricing/cloudflare-workers-pricing-breakdown/ · https://adamarant.com/en/blog/cloudflare-workers-ai-vs-the-openai-api-where-each-wins
- Embeddings: https://www.marktechpost.com/2026/10/01/cohere-releases-embed-5/ · https://explainx.ai/blog/cohere-embed-5-pro-fast-vidore-v3-2026
- Cohere pricing: https://blog.9cv9.com/what-is-cohere-command-a-model-how-it-works-its-use-cases/

*Pricing and model availability change quickly — re-verify before signing anything. This doc pins the Oct 2026 snapshot.*

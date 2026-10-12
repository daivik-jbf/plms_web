# Vibe-Coding to Senior-Engineer Standards — Master Prompt & Workflow

## Quick start — do this, right now, in order

1. Write a one-page spec yourself first (what it does, the one thing it must get right, any non-negotiables) — before opening the IDE.
2. Paste the Master Prompt (§1) into a fresh session. Let it ask you Discovery questions — answer honestly, don't let it skip to code.
3. Review the architecture it proposes. Approve it explicitly, in writing, before any implementation starts.
4. Order the milestones by dependency: data model + auth first, then the one core feature that proves the product, then secondary features, then polish.
5. Build one milestone per session — that milestone plus the approved architecture doc, nothing more.
6. Review the diff, verify tests, commit — only then approve moving to the next milestone.
7. Repeat step 5–6 until the milestone list is done, always opening new sessions with the architecture doc + what's already built.
8. Run the harden pass (§4) across the whole system, then ship the smallest usable version rather than waiting for "finished."
9. Keep `ARCHITECTURE.md`, `PROGRESS.md`, `TASKS.md`, `DECISIONS.md`, and `CHANGELOG.md` updated as you go (§13) — this is what lets you stop for days and pick up exactly where you left off.

The rest of this document is the detail behind each of those steps.

**New to software development?** You don't need prior experience to use this system — it's built so the AI carries the technical expertise and you carry the decisions. Add this line to the master prompt's constraints: *"Explain every decision in plain language, as if I'm new to software development."* Practice the whole loop once on something tiny and low-stakes before pointing it at your real project, and never approve something you don't understand — ask it to explain again instead. That habit matters more than any prior knowledge.

**Reality check, unsugarcoated:** this process meaningfully reduces risk and rework, but it does not turn a beginner into someone who can independently verify security- or compliance-critical code. Understanding an explanation of what code does is not the same as being able to catch a subtle security gap, an auth check missing on one route, or a compliance mistake — those are real failure modes even senior engineers catch each other's mistakes on, via code review, and a beginner reviewing alone will miss some of them. Concretely: if you're building an HRMS or CRM with real employees' or customers' real personal data, or an ERP touching real money, don't put it in front of real people until it's had a real security review from someone qualified — a prompt process, however good, is not a substitute for that. Start with a narrow, low-stakes slice, or treat the first full build as a learning project rather than a production system for real people's data, until you've either grown the skill to judge it yourself or brought in someone who can.

---

This is a reusable system for building software with an AI coding assistant (Claude Code, Cursor, Windsurf, etc.) so the output meets professional standards — SOLID, reliable, scalable, secure, maintainable — **without burning tokens on rework**.

The core idea: **most wasted rework happens because code gets generated before the requirements and architecture are locked.** So this workflow forces a cheap, text-only planning phase before any code is written, then implements in small verified increments.

---

## 0. The Workflow (do this every time)

| Phase | What happens | Output | Cost |
|---|---|---|---|
| 1. Discovery | AI asks you clarifying questions, you answer | A written spec (1 page) | cheap |
| 2. Architecture | AI proposes stack, module boundaries, data model | A written design doc | cheap |
| 3. Plan approval | You review and approve/edit the doc | Locked scope | free |
| 4. Implementation | AI builds in small vertical slices, one at a time | Working, tested code | most tokens, spent efficiently |
| 5. Review & harden | Security/perf/test pass on the whole system | Production-ready system | cheap |

**Never let the AI skip straight to Phase 4.** Skipping planning is the #1 cause of rework — the AI guesses at requirements, builds the wrong thing, and you pay twice.

---

## 1. The Master Prompt (copy this into your IDE / Claude Code)

Fill in the bracketed parts, then paste this as your first message in a fresh session.

```
You are acting as a senior software engineer (15+ years) responsible for the
full lifecycle of this system: architecture, implementation, testing, and
security review. Hold yourself to professional engineering standards, not
"quick demo" standards.

PROJECT
[One paragraph: what the system does, who uses it, and the single most
important thing it must get right.]

NON-NEGOTIABLE CONSTRAINTS
- Language/stack preference (if any): [e.g. "TypeScript + Postgres" or "no preference, recommend one"]
- Expected scale: [e.g. "100 users to start, should handle 100k without a rewrite"]
- Deployment target: [e.g. "AWS", "single VPS", "serverless", "unsure — recommend"]
- Compliance/security requirements: [e.g. "handles user PII", "none"]
- Budget/complexity ceiling: [e.g. "prefer boring, proven tech over cutting-edge"]
- Cost awareness: flag the cost implication of every infrastructure choice you propose, and default to the cheapest option that meets today's actual scale — not hypothetical future scale.

ENGINEERING STANDARDS (apply to all code you write)
- SOLID principles, clear separation of concerns, no god-objects/god-functions.
- Explicit error handling — no silently swallowed exceptions.
- Input validation and output encoding at every trust boundary.
- No secrets, credentials, or keys hardcoded — use environment/config injection.
- Structured logging at meaningful points (not console.log debugging left in).
- Automated tests for business logic and edge cases, written alongside the code
  (not deferred to "later").
- Idempotent, side-effect-aware operations wherever the system does writes.
- Dependencies must be current, actively maintained, and justified — no
  unnecessary packages "just in case."
- No dead code: no commented-out blocks, unused functions/variables/imports,
  or "just in case" branches left in. If something becomes unused after a
  change, delete it in the same change, don't leave it.
- One global design system, not per-page styling: define color, type, and
  spacing as reusable tokens/variables once, and every screen consumes them.
  No screen invents its own one-off colors or spacing values.
- UI must be fully responsive (mobile, tablet, desktop) and avoid generic
  "default AI template" look — see DESIGN DIRECTION below.

DESIGN DIRECTION
- Design a small token system first (a handful of named colors, 1–2
  typefaces, a spacing scale) before styling any screen, and reuse it
  everywhere — this is what makes the UI feel like one coherent product
  instead of a pile of AI-generated screens.
- Make deliberate choices suited to what this specific product is and who
  uses it, rather than defaulting to generic SaaS-template patterns (identical
  rounded cards with the same soft shadow everywhere, one warm-cream-and-serif
  look, ALL-CAPS section labels, arrows tacked onto every button). Distinctive
  and intentional beats trendy-for-its-own-sake.
- Prioritize clarity and ease of use for the end user over visual novelty —
  a simple, obvious interface beats an impressive-looking confusing one.
- Respect accessibility basics: visible keyboard focus, sufficient color
  contrast, reduced-motion support.
- Before styling any screen, show me the design plan first (palette, type,
  layout concept, in a few lines) and wait for my go-ahead. Don't make
  visual decisions I haven't seen — a plan I can react to is cheap, a
  screen I have to ask you to redo is not.

WORKFLOW RULES (follow in order — do not skip ahead)
1. DISCOVERY: Ask me clarifying questions about anything ambiguous in the
   requirements above before proposing anything. Do not write code yet.
   Ask in plain, non-technical language with a concrete example where it
   helps — I may not have a software background. If a question is really a
   technical decision (which database, which auth library, etc.) rather
   than a product question, don't make me choose blind: recommend the
   default yourself, explain the trade-off in plain terms, and ask me to
   confirm rather than pick.
2. ARCHITECTURE: Once requirements are clear, produce a short written design:
   - Proposed tech stack with a one-line justification for each choice
   - High-level module/service boundaries and how they communicate
   - Data model (entities and relationships)
   - Key risks or trade-offs I should know about
   Do not write implementation code yet. Wait for my explicit approval of
   this design before proceeding.
3. PLAN: Break the approved design into small, independently testable
   milestones (vertical slices, not "backend" then "frontend"). List them
   and their order before starting.
4. BUILD: Implement one milestone at a time. Before writing anything for a
   milestone, restate in plain language what you're about to do and why,
   and wait for me to say go — never implement on silence or assumption.
   After each milestone:
   - Summarize what you built and why, in plain language
   - Show how to run/test it
   - State any assumptions you made
   - Stop and wait for my confirmation before moving to the next milestone.
5. HARDEN: After all milestones are built, do a final pass for security
   (auth, injection, secrets, dependency vulnerabilities), reliability
   (error paths, retries, timeouts), and scalability (obvious bottlenecks).
   Report findings before fixing them.

If at any point you are uncertain about a requirement, ask me — do not
assume and proceed. Assuming wrong is more expensive than asking.

CHANGE REQUESTS (when I change or add a requirement mid-build)
Do not just bolt the change onto the nearest file. Instead:
1. Tell me which parts of the current architecture/design doc the change
   affects.
2. Tell me if it's a clean addition (fits existing structure) or a structural
   change (requires reshaping existing modules).
3. If it's structural, propose the smallest reshape that keeps the rest of
   the system consistent, and remove/refactor anything the change makes
   obsolete — don't leave old code paths behind "just in case."
4. Only implement after I confirm. Update the design doc to reflect the
   change so it stays the source of truth.

PERSISTENT MEMORY (so work resumes cleanly across sessions/days)
At the start of every session (new or resumed): read ARCHITECTURE.md,
PROGRESS.md, TASKS.md, and DECISIONS.md before doing anything else. Summarize
your understanding of the current state and confirm it with me before
continuing — don't rely on chat history, which may not exist in this session.
At the end of every session (after any real change): update PROGRESS.md
(what's done/in progress/next), check off completed items in TASKS.md, and
append a dated line to CHANGELOG.md describing what changed. Never end a
session with these files out of date.

GIT DISCIPLINE
- Before starting any new work: pull the latest changes and check status
  first — I may have committed and pushed directly to main myself outside
  this session. Never assume your local copy is current.
- After a milestone is reviewed and approved: pull again (in case anything
  changed since you started), then commit, then push.
- Commit messages: "<type>: <what changed, plain language>" where <type>
  is feat / fix / refactor / docs / test / chore / style. Example:
  "feat: add phone number validation to signup form". Keep the first line
  under ~72 characters.
- If a pull produces a merge conflict, stop and show me exactly what
  conflicts and why, in plain language. Never auto-resolve or force-push
  without me confirming which version should win.
```

---

## 2. Why this reduces wasted rework (and tokens)

- **Text is cheap, code is expensive.** A misunderstanding caught in the Discovery/Architecture doc costs one message. The same misunderstanding caught after 2,000 lines of generated code costs a rewrite.
- **Milestone checkpoints stop drift.** Long, unsupervised generation is where AI coding tools go off the rails — each checkpoint is a chance to catch a wrong turn early.
- **"Ask, don't assume" is explicit.** Left to their own devices, coding assistants default to guessing plausible requirements rather than asking. Saying it directly changes that behavior.
- **Vertical slices > horizontal layers.** Building "the whole backend" then "the whole frontend" means nothing is testable until both are done. Building one working end-to-end feature at a time means you catch integration problems immediately, not at the end.
- **Locking scope per session** prevents the assistant from quietly expanding what it's building mid-task.

---

## 3. Tech stack selection — how to decide, not just what to pick

Ask the assistant to justify each choice against these criteria, in this order of priority:

1. **Fit for the actual scale you need** — don't select for hypothetical scale you don't have yet; over-engineering wastes as much effort as under-engineering.
2. **Maturity and community support** — boring and proven beats new and shiny for anything you'll maintain long-term.
3. **Operational simplicity** — fewer moving parts to deploy, monitor, and secure.
4. **Team/你 familiarity** — a stack you can actually read and debug beats a theoretically "better" one you can't.
5. **Ecosystem for your specific need** — e.g., if you need heavy real-time features, that should weight the choice more than general popularity.

A reasonable default for most CRUD-style products in 2026: a typed language (TypeScript or similar), a relational database (Postgres) unless you have a specific reason not to, and a managed hosting platform rather than self-managed infra — until you have a concrete reason to need more control.

---

## 4. Reliability / Scalability / Security — a checklist to hand the AI at Phase 5

**Reliability**
- Every external call (DB, API, network) has timeout + retry + failure handling
- No single point of failure for critical paths
- Health checks / readiness checks if deployed as a service
- Meaningful error messages logged with enough context to debug without reproducing

**Scalability**
- Stateless application layer where possible (state lives in the DB/cache, not in memory)
- Database queries are indexed for their actual access patterns
- No N+1 query patterns
- Clear path to horizontal scaling if load grows (even if not implemented yet)

**Security**
- All user input validated server-side (never trust client-side validation alone)
- Parameterized queries — no string-concatenated SQL
- Auth/authorization checked at every protected route, not just in the UI
- Secrets in environment variables / secret manager, never in source
- Dependencies checked for known vulnerabilities before shipping

**Durability**
- Data backups / migrations are scripted and repeatable, not manual
- Schema changes are versioned migrations, not hand-edited

---

## 5. Which tool to actually build this in

- **Claude Code** (terminal, desktop, or IDE extension) is the strongest fit here — it's built for exactly this multi-step, agentic build-review-fix loop, can run your tests and see the results, and keeps context across a long build rather than losing the thread between files.
- If you're doing this inside claude.ai chat instead, the same master prompt works, but you'll need to paste code back and forth manually since there's no live filesystem/test execution.

---

## 6. Keeping the UI/UX consistent globally (design system, not per-page styling)

The reason vibe-coded UIs feel disjointed screen-to-screen is that each screen gets styled in isolation, in a separate generation pass, with no shared source of truth. Fix this by making the AI build a **design token system first**, before it styles a single screen:

- A small named color palette (4–6 core colors — background, surface, text, primary accent, and 1–2 supporting colors), not colors picked ad hoc per component.
- 1–2 typefaces with a defined type scale (heading sizes, body size, line-height), not whatever font size felt right on each page.
- A spacing scale (e.g. 4/8/16/24/32px steps) used everywhere instead of arbitrary padding/margin values.
- One component set (buttons, cards, inputs, nav) built once and reused, not re-implemented per screen.

Once this exists, every new screen should be instructed to **reuse** these tokens/components rather than invent new ones. If a new screen seems to need a new color or a new button style, that's a signal to update the shared system deliberately — not to quietly add a one-off.

## 7. Avoiding the generic "obviously AI-generated" look

This is a real, well-known pattern — AI coding tools default to a recognizable set of visual tics unless explicitly steered away from them. Tell your assistant to avoid, unless your brand specifically calls for it:

- The same soft-shadow rounded card used for everything, regardless of what the content actually is
- One warm-cream background with a serif headline and a terracotta/orange accent (this specific combination is such a common default it's practically a tell)
- ALL-CAPS section labels, arrows tacked onto every button ("Learn more →"), and centered hero sections with a gradient blob behind them as the default for every page
- Fade-and-slide-up animations on every section as content loads

Instead, ask for **one deliberate design decision that fits what this specific product is** (a finance dashboard should not look like a children's app), and keep everything else restrained around it. "Modern" in practice means: clean type hierarchy, generous whitespace, one clear focal point per screen, and consistency — not maximal decoration or the trendiest color of the month.

## 8. No dead code, properly structured codebase

Ask explicitly for this as an ongoing discipline, not a one-time cleanup:

- Delete code in the same change that makes it unused — don't comment it out "in case we need it later" (version control already remembers it).
- One clear folder/module structure agreed in the architecture phase (e.g. by feature/domain, not by file type scattered everywhere), and every new file goes where that structure says it goes.
- No duplicate logic — if the same thing is being done two places, it should be one shared function, not two similar copies.
- Periodically (e.g. every few milestones) ask the assistant to do a short "cleanup pass": find unused exports, dead branches, and structural drift from the original design.

## 9. Handling changing requirements without wrecking the codebase

This is normal — requirements always evolve, and no process eliminates rework entirely once something genuinely changes. What separates a clean outcome from a mess is **how the change is absorbed**:

- Don't let the assistant patch the nearest file to make a new requirement "work." Have it first say what the change affects and whether it's additive or structural (the CHANGE REQUESTS rule in the master prompt above does this).
- If it's structural, let the reshape happen deliberately and completely — half-migrated code (some parts using the old pattern, some the new one) is the single biggest source of the "messy, unprofessional" feeling you're describing.
- Keep the architecture doc from Phase 2 updated as the source of truth. If it drifts out of sync with the actual code, that gap is exactly where confusion and rework compound.
- Bigger changes mid-project cost more than the same change requested up front — that's just true regardless of process. The Discovery phase exists to catch as much of this as possible before code exists, precisely because it's the cheapest place to catch it.

## 10. What professional "vibe coders" actually do differently

The difference isn't a smarter prompt — it's discipline around the loop:

1. They spend real time on the spec/architecture before generating code, even when it feels slow.
2. They review every meaningful chunk of generated code before moving on, rather than letting the AI run for a long time unsupervised.
3. They commit to version control after every working milestone, so a bad turn can be rolled back cheaply instead of unwound by hand.
4. They keep sessions scoped — one milestone or one bug per session — instead of one sprawling conversation that drifts.
5. They treat the AI's first draft as a draft: they ask it to critique its own output (security pass, dead-code pass, design-consistency pass) as a separate explicit step.
6. They maintain one living design/architecture doc as the source of truth, and update it when requirements change, instead of letting the code and the plan diverge.
7. They pick boring, proven tech for anything load-bearing and save novelty for the parts of the product that actually differentiate it.

---

## 11. The production-readiness layer you haven't asked about yet

Everything above covers code quality and UI. A few things sit outside both and still matter once a system has real users:

- **Documentation** — a README with setup/run instructions, and the architecture doc from Phase 2 kept current. This is as much for future-you as anyone else.
- **Version control discipline** — commit after every working milestone with a real message, branch for anything non-trivial, review your own diff before accepting it even when working solo.
- **Environments** — separate dev vs. production config at minimum, so testing never touches real user data.
- **CI basics** — tests run automatically on push, not just when you remember to run them by hand.
- **Observability** — beyond logs: something that tells you when production breaks *before* a user has to report it.
- **Backups & recovery** — scheduled database backups, and a backup you've actually restored once to confirm it works — an untested backup is not a backup.
- **Legal/compliance basics** — a privacy policy and terms if you collect any user data; awareness of the licenses on the open-source packages you depend on.
- **Cost & abuse controls** — rate limiting on public endpoints and a budget alert on cloud spend. AI-assisted builds can rack up infra costs quietly if nothing is capped.
- **Accessibility, the fuller version** — alt text, semantic HTML/ARIA labels, not just keyboard focus and contrast.
- **A "definition of done" per milestone** — tests pass, docs updated, no dead code left, self-reviewed — so nothing gets marked finished prematurely.
- **Post-launch maintenance** — a cadence for dependency and security updates, and a monthly check of the cloud bill against what you expected (see §14 — cost drift is cheap to catch early, expensive to catch three months in).

This is the *full* checklist — right-size it. Formal CI, tested backups, and legal docs matter a lot if you're handling real users' data or money, and are overkill for a personal project or prototype. Tell the assistant which category you're actually in so it doesn't over-engineer a to-do app like it's a bank.

### For your case: public product, real users

At this tier, these aren't optional extras — build them in from the start:

- **Auth done properly** — use a managed auth provider or a well-vetted library; never hand-roll password hashing or session handling.
- **Injection/XSS/CSRF protection and input validation on every public endpoint** — with real users, this is an actual attack surface, not a hypothetical.
- **Rate limiting / abuse prevention** on anything public-facing (signup, login, any write endpoint).
- **Error tracking + uptime monitoring** — you want to know something broke before a user emails you about it.
- **Scheduled backups with at least one tested restore.**
- **Separate dev and production environments/config**, so you're never testing against real user data.
- **Tests running automatically on every push (CI)** — doesn't need to be elaborate, just automatic.
- **A basic privacy policy and terms of service** the moment you collect any personal data (email, name, usage).
- **Dependency vulnerability scanning** — most package managers have a free built-in audit command; run it regularly.
- **Real accessibility basics** — contrast, keyboard navigation, alt text. "Real users" includes users with disabilities.

Fine to defer until you have actual traffic/scale data telling you it's needed:

- Multi-region infrastructure or heavy horizontal-scaling setup
- Multiple staging environments / elaborate CI-CD pipelines
- Formal architecture decision records
- A full design-system *product* — a token file plus a shared component set is enough for now

Not required yet, but revisit the moment it becomes true: PCI-level payment handling standards, formal data-residency/compliance work — those only kick in once you actually collect payments or classified-sensitive data.

---

## 12. Field-level input validation (what you were pointing at)

Yes — that's a real gap: field-level validation rules, not just "validate input" as a generic statement. Add this to the Architecture phase for every form the system has, so the assistant defines rules per field up front instead of guessing per screen later.

**General rules:**
- Validate on both the client (fast feedback) *and* the server (the one that actually counts — client-side validation is UX, not security).
- Show what's expected *before* rejecting input where possible (a hint under the field), not just an error after submit.
- Validate on blur or on submit, not on every keystroke — flagging an error while someone's still mid-typing their name feels punishing.
- Never silently mutate what someone typed without showing them (e.g. auto-stripping characters) — reject and explain instead.

**Common fields and sane rules:**

| Field | Rule |
|---|---|
| Name | Letters plus spaces, hyphens, and apostrophes (`O'Brien`, `Anne-Marie`); no digits or symbols. Allow accented/unicode characters — don't restrict to ASCII only. Set a generous max length, not a strict pattern for "what a name looks like." |
| Phone number | Digits only after stripping formatting; validate length against the actual country format you're targeting, don't hardcode a single length unless the product truly is single-country. Store as a string (leading zeros, `+` prefix matter), never as a number. |
| Email | Use a well-tested library/regex, not a hand-rolled one — email format edge cases are wider than people expect. |
| Password | State the rules up front (min length, etc.) before they submit, not after rejection. No silent max-length below what a password manager would generate. |
| Date of birth | Valid calendar date, sensible range (no future dates, no 200-year-old users) if age-gated. |
| Postal/zip code | Format varies by country — don't hardcode a single pattern if you serve more than one country. |
| Numeric fields (age, quantity, price) | Enforce type + min/max range, not just "is it a number." |

**One thing worth flagging on your own example:** "phone should be 10 digits" is only true if every user is in one specific country (e.g. US/India). If this product could ever have international users, hardcoding 10 digits will lock real people out. Worth deciding now whether this is single-country or global — it changes the phone (and postal code) rules above.

---

## 13. Persistent memory across sessions (so a gap of days doesn't lose anything)

A chat session has no memory of a different session — that's true regardless of which AI tool you use. If the project's state only lives in the conversation, closing it (or the session ending on its own) loses that state. The fix professional AI-assisted builders use: **the source of truth lives in files in the project, never in chat history**, and every session — new or resumed — starts by reading them.

**The document set** (plain markdown files, kept in the project root or a `/docs` folder):

| File | Purpose | Updated |
|---|---|---|
| `ARCHITECTURE.md` | The approved Phase 2 design — stack + why, module boundaries, data model. The "what are we building and how." | Rarely — only through the CHANGE REQUESTS process (§9) |
| `PROGRESS.md` | What's done, what's in progress, what's next, and any open questions. **The single most important file for resuming after a gap.** | End of every session |
| `TASKS.md` | The milestone list from Phase 3, as checkboxes, in dependency order. Shows exactly where you are at a glance. | As each milestone completes |
| `DECISIONS.md` | A running, dated log of decisions and why ("Chose Postgres over Mongo because X"). Stops you and the assistant relitigating settled questions in a new session. | Whenever a real decision is made |
| `CHANGELOG.md` | One line per meaningful change, dated, append-only. | After any real change |

`README.md` is different from all of these — it's for end users/collaborators (setup instructions), not working memory. Keep it separate.

**Which to read when a new chat starts:** all four working-memory files (`ARCHITECTURE.md`, `PROGRESS.md`, `TASKS.md`, `DECISIONS.md`) — the PERSISTENT MEMORY rule already in the master prompt (§1) makes this automatic. Never let the assistant reconstruct the project from memory or guesswork; the files are the memory.

**Resuming after days away** — open the new session with:

```
This is a continuing project, not a new one. Before doing anything:
1. Read ARCHITECTURE.md, PROGRESS.md, TASKS.md, and DECISIONS.md.
2. Summarize what's built, what's in progress, and what's next — confirm
   your understanding with me before continuing.
3. Continue from the next unchecked item in TASKS.md, following the same
   engineering and design standards established in ARCHITECTURE.md.
```

If you're using Claude Code specifically, it has built-in support for a persistent project-memory file that loads automatically each session — worth checking docs.claude.com for the current exact setup, since I can't verify the latest specifics from here. Either way, the file-based system above works with any IDE or assistant, which is why it's the safer default to rely on.

---

## 14. Why vibe-coded systems often cost more to run than expected

This is a real, widely reported pattern, not just anecdote. AI assistants default to infrastructure that's *technically correct* but not *cost-aware* — because "make it work" and "make it cheap" are different objectives, and only the first gets optimized for unless you ask for the second explicitly.

**Where the cost creep actually comes from:**
- **Over-provisioned infrastructure for the actual traffic** — a large compute instance or full cluster setup for a product with a handful of users. Right-size to today's real load (same principle as §3 tech stack selection), not a hypothetical future one.
- **Always-on servers where pay-per-use would do** — for low/unpredictable early-stage traffic, serverless or managed pay-per-request pricing is usually cheaper than a server running 24/7 at low utilization.
- **No budget cap or alert set before deploying** — most overruns aren't one bad decision, they're the absence of a ceiling. Set a billing alert — and a hard spending limit where the platform offers one — before launch, not after the first surprising invoice.
- **Inefficient queries and missing indexes** — the same N+1 query problem flagged under Reliability (§4) shows up directly as a bigger database bill. Performance and cost are the same lever here.
- **Verbose logging left on in production** — debug-level logs generate real storage/ingestion cost at scale. Trim to what you'd actually use to debug an incident.
- **Orphaned resources from experimentation** — test databases, staging deployments, storage buckets spun up while building and never torn down. Worth a periodic sweep.
- **Defaulting to a premium managed service where a cheaper one does the job** — e.g. a dedicated managed vector database when Postgres with an extension covers the same need at this scale.

**Add this to your prompt:** ask the assistant to justify the *cost*, not just the technical fit, of every infrastructure choice made in the Architecture phase (§0, §1), and to flag anything provisioned for scale you don't have yet. This is a one-line addition to the NON-NEGOTIABLE CONSTRAINTS section of the master prompt — e.g. "flag the cost implication of every infra choice, and default to the cheapest option that meets today's actual scale."

---

## 15. Getting genuinely great UI — references, using a different tool when Claude's design falls short, and the polish checklist

**"It's designing blindly without my knowledge"** — the fix is the design-plan rule now added to §7/DESIGN DIRECTION above: the assistant shows you the palette/type/layout plan *before* touching any screen, so you're approving a direction, not reacting to a surprise. If it's still building without showing you first, say so explicitly each session — it's a rule the assistant needs reminding of until it's habit.

**Real places to calibrate "good"** — I linked a few above (Awwwards, Mobbin, Land-book, SiteInspire). Before asking for a screen, find one or two references close to what you're building and tell the assistant "match this general direction," rather than saying "make it look amazing" — the second is too vague for any tool to act on well. I don't have live browsing right now, so I can't pull specific current shots for you, but those galleries are stable, well-known references worth bookmarking.

**When Claude's UI output isn't good enough, and you want to use ChatGPT/Codex for the visual design instead:** this is a completely reasonable hybrid workflow — use whichever tool is actually better at the specific job. The handoff:

1. Ask Claude (in this chat, or Claude Code) to generate a **design brief** for the external tool — add this as a standing instruction:
   > "Generate a standalone UI design brief I can paste into another AI tool, for [screen name]. Include: what the product is, who uses it, the established palette/type/spacing tokens from ARCHITECTURE.md, one deliberate visual direction for this screen, and what content/functionality it needs to contain. Do not include implementation code — this is for a different tool to design, not build."
2. Paste that brief into ChatGPT/Codex, get back a mockup (image or coded prototype).
3. Bring the result back to Claude Code with:
   > "Implement this screen to match the attached reference exactly — same layout, spacing, and visual hierarchy. Use our existing design tokens from ARCHITECTURE.md for colors/type so it stays consistent with the rest of the system. Before marking this done, check for: overflow, hidden or clipped elements, misalignment, and broken responsiveness at mobile/tablet/desktop widths."

That last instruction is the one that actually prevents the overflow/hidden/misalignment problems you mentioned — asking generically for "good UI" doesn't trigger a self-check, asking explicitly for one does.

**The polish/QA checklist** — treat this as acceptance criteria for any UI milestone, not a one-time pass at the end:
- No overflowing or clipped content at any screen width (test mobile, tablet, desktop)
- No hidden/inaccessible elements (things behind other things, off-screen, or unreachable by keyboard)
- Consistent alignment and spacing against the token system (§6) — nothing "eyeballed" per screen
- No layout shift or visual glitches on load or interaction
- Standard utility pages/states exist and are actually designed, not left default: a 404 page, a generic error/500 page, empty states (e.g. "no items yet"), and loading states — these get forgotten because they're not the "main" screens, but a polished product needs them too.

**On the "award-winning" bar specifically:** genuinely Awwwards-level design usually comes from iteration and critique, not a single generation — even human design studios do multiple concepts and a self-critique pass before shipping one. Ask for 2–3 distinct directions for your most important screen, pick the strongest, and ask the assistant to critique its own output against the reference before calling it done (the frontend-design process already folded into §7 — plan, review against the brief, build, critique — is built for exactly this). That loop gets you closer to "wonderful" than a single one-shot prompt ever will, regardless of which tool does the drawing.

**Database migrations, and utility pages, tying back to earlier sections:** future-proofing schema changes is already a standing rule in §4 ("schema changes are versioned migrations, not hand-edited") — reconfirm it explicitly when the architecture doc is written, and make sure whatever database tooling you pick has a migration system (most modern ones do). The utility pages above (§15) pair with that: as the schema or product evolves, those pages are exactly where broken states tend to surface first.

---

## 16. Two habits that matter more than any single rule in this document

"Vibe coding," as the term was originally used, meant trusting the output without reading it. Everything else in this document is scaffolding around avoiding exactly that, so it's worth naming directly:

1. **Never approve code you don't understand, even when it works.** Skimming and accepting is how the disorganized, "not-professional-feeling" outcome you described at the start of this conversation actually happens — not from a bad prompt, but from not reading the answer before moving on.
2. **Verify every dependency actually exists and is the real, legitimate package before installing it.** AI coding tools occasionally suggest package names that sound plausible but aren't real or aren't what they claim to be — check the registry before adding anything to your dependency list, especially anything touching auth, payments, or user data.
3. **Don't trust AI-generated tests at face value.** A test that runs and passes isn't the same as a test that checks the right thing. Skim what each test actually asserts, not just whether the suite shows green — this is one of the more common ways a vibe-coded system looks "tested" while real bugs still slip through.

---

## 17. Performance without inflating cost, and building different system types with the same process

**Performance vs. cloud cost — these aren't actually in tension if you optimize in the right order.** Spend in this sequence, not the reverse:

1. **Code-level fixes first — free performance:** correct database indexing on your actual query patterns, caching (application-level for repeated expensive work, CDN for static assets, HTTP cache headers), pagination/lazy loading instead of fetching everything at once, and fixing N+1 queries. These are the same items flagged under Reliability (§4) and Cost (§14) — fixing them once pays off in both directions.
2. **Measure before scaling infrastructure:** profile or monitor to find the actual bottleneck rather than guessing and over-provisioning broadly "to be safe."
3. **Spend more only where it's genuinely business-critical:** the paths users hit constantly or that the product's value depends on — login, checkout, the core action the product exists for. A slow settings page nobody visits daily doesn't need the same investment as a slow checkout flow.

Add to your prompt: *"Optimize [the specific critical path] for performance even if it costs slightly more. Everywhere else, default to the cheapest option that meets a reasonable response-time target, and fix through code before reaching for more infrastructure."* Also worth setting an actual number as a target (e.g. "pages load under 2 seconds," "API responses under 300ms") — "good performance" is only actionable once it's measurable.

**Same process for LMS, HRMS, CRM, ERP, or a website — yes, I follow you.** The 5-phase workflow and master prompt don't change per system type; what changes is what you emphasize during Discovery and put in the constraints section:

| System | What matters most, beyond the general standards |
|---|---|
| LMS (learning) | Course/content structure, accurate progress tracking, likely video storage/streaming cost, multi-role access (student/instructor/admin) |
| HRMS (HR) | The most sensitive personal data on this list — compliance and audit trails matter more here than almost anywhere else; payroll-adjacent data must be exactly correct, not approximately |
| CRM (sales/customer) | Data import/export at scale, search/filter speed as records grow, integrations (email, calendar) are often the actual product value |
| ERP (operations) | Usually the most complex — multiple interconnected modules (inventory, finance, procurement) where a single update must be atomic, correct, and traceable; highest stakes for correctness on this list |
| Website | Simplest data model of the group; performance and SEO have a direct, measurable business effect, so §17's performance guidance applies hardest here |

Practical implication: reuse the same master prompt every time, but rewrite the `NON-NEGOTIABLE CONSTRAINTS` section per project. For an HRMS, for example, you'd add "stores employee PII; must comply with [relevant regulation]" as a day-one constraint — not something addressed after the fact.

---

## 18. Two decisions to lock in early for LMS/HRMS/CRM/ERP-type systems — expensive to change later

Every one of those four system types shares a couple of foundational forks that are cheap to decide during Architecture and genuinely expensive to retrofit once code exists — worth naming since "expensive to retrofit" is exactly the rework you started this whole conversation trying to avoid:

- **Role-based access control (RBAC).** All four have multiple user types with different permissions (student/instructor/admin; employee/manager/HR; rep/sales-manager; department/finance/admin). Decide the roles and what each can see/do during Architecture, not after the first screen is built — bolting permission checks onto code that assumed a single user type is one of the most common expensive-rework patterns in exactly this category of system.
- **Single-tenant vs. multi-tenant.** Is this an internal tool for one company, or a product you might sell to many companies? The answer changes the data model and security boundaries from the first line of code (multi-tenant needs strict data isolation between customers). Decide explicitly — don't leave it implicit and discover the answer should have been different once you have real users.

Two smaller things worth a line in the Architecture doc for any of these systems, if relevant to what you're building: an **audit trail** (who changed what, when — expected in HRMS/ERP/CRM once real business data is involved) and whether you need **notifications/email** and **reporting/dashboards** as first-class features rather than afterthoughts.

---

## 19. Git discipline — pull, check, commit, push, labeled, no conflicts

This is now a standing rule in the master prompt (GIT DISCIPLINE), so you don't have to ask for it each time. The loop:

1. **Pull first, always** — before starting any new work, and again right before committing. This is the actual conflict-prevention mechanism: most conflicts happen because local work was based on an outdated copy, not because two changes were genuinely incompatible.
2. **Check status** before touching anything — see if there are uncommitted or unexpected changes (from you working directly on main, which the rule explicitly accounts for) before the assistant starts editing on top of them.
3. **Commit with a labeled message**, not "update" or "fix stuff": `<type>: <what changed>`, where type is one of:

| Type | Use for |
|---|---|
| `feat` | A new feature or capability |
| `fix` | A bug fix |
| `refactor` | Restructuring code without changing behavior |
| `docs` | Documentation only (including `PROGRESS.md`/`ARCHITECTURE.md` updates) |
| `test` | Adding or fixing tests |
| `chore` | Dependency bumps, config, maintenance |
| `style` | Formatting only, no logic change |

   e.g. `feat: add phone number validation to signup form`, `fix: correct N+1 query on dashboard load`. This is the same convention (Conventional Commits) most professional teams use — readable at a glance, and it makes `CHANGELOG.md` easy to keep accurate since the commit history and the changelog end up saying the same thing.
4. **Push.**

**On you sometimes committing and pushing to main yourself:** that's fine and explicitly accounted for — the rule tells the assistant to never assume its local copy is current and to pull before doing anything, every single time. If your manual commit and its next piece of work happen to touch the same lines, you'll get a conflict regardless of process — that's just what happens when two changes overlap. What the rule guarantees is that the assistant stops and shows you the conflict in plain language rather than guessing which version should win or force-pushing over your changes.

---

## Coverage checklist — everything this conversation has covered, at a glance

| Topic | Section |
|---|---|
| Planning workflow & quick start | Quick Start, §0, §1 |
| Why this avoids wasted tokens/rework | §2 |
| Tech stack selection | §3 |
| Reliability / scalability / security / durability | §4 |
| Which IDE to use | §5 |
| Global design system / UI consistency | §6 |
| Avoiding the generic "AI-generated" look | §7 |
| No dead code, clean structure | §8 |
| Handling changing requirements mid-build | §9 |
| What professional vibe coders actually do | §10 |
| Production-readiness layer (docs, CI, monitoring, backups, legal, accessibility) | §11 |
| Field-level input validation | §12 |
| Persistent memory across sessions/days | §13 |
| Cloud cost control | §14 |
| UI references, external-tool design handoff, polish/QA checklist | §15 |
| Verifying, not just trusting, AI output | §16 |
| Performance vs. cost balance, and building LMS/HRMS/CRM/ERP/websites with the same process | §17 |
| RBAC, multi-tenancy, audit trails — the early architectural forks for business systems | §18 |
| Git discipline — pull/check/commit/push, commit labeling, avoiding conflicts | §19 |

That's genuinely comprehensive now. From here, further gaps would be specific to the one exact system you build first — not something a generic document can anticipate — and that's fine: §9 (change requests) and §13 (persistent memory) exist precisely so new things surfacing mid-build get absorbed cleanly instead of derailing anything. The honest next step is to start, not to keep auditing.

---

### A note on your two "shoulds"

Two things worth naming directly, since you asked to be pushed back on:

- **"Latest, modern, best" UI** is worth wanting, but if you chase novelty for its own sake you'll get exactly the "trendy but generic" look you're trying to avoid — the fix isn't newer components, it's *fewer, more deliberate* choices (section 7). Consistency and clarity read as "professional" far more than visual flair does.
- **Zero rework from changing requirements** isn't a realistic bar — even senior human teams re-plan and refactor when scope changes. The realistic goal is making change *cheap and clean* (sections 6–9), not eliminating it.


---
name: implement
description: Implements a spec file end-to-end — breaks it into Sessions, works through each behind a test gate and a review gate, checkpoints progress to a state file so work survives across separate conversations, then opens a PR with evidence of what shipped and drives its checks green. Run explicitly as /implement <spec path>.
disable-model-invocation: true
---

Drives a spec file under `specs/` to a green PR. The spec is broken into **Sessions** — coherent, independently testable slices of the work — each checkpointed to a state file on disk as it completes, so the run can pause and resume across entirely separate conversations without losing progress.

## Process

### 1. Locate the spec and its state

- Argument = path to the spec file. If none given, list `specs/*.md` (excluding `specs/completed/`) and ask which one. If the given path doesn't exist under `specs/`, also check `specs/completed/` before failing — it may already be done.
- Read the spec in full.
- Look for a sibling state file at `specs/<spec-name>.state.md`:
  - **Exists, `status: complete`** — tell the user this spec is already implemented, name the PR from the state file, and stop.
  - **Exists, `status: planned` or `in-progress`** — this is a **resume**. `git checkout` the branch named in the state file and skip to step 3, at the first Session not marked `done`.
  - **Doesn't exist** — this is a **fresh start**. Continue to step 2.

Completion criterion: spec read in full; resume-vs-fresh determined; if resuming, every Session's status loaded from the state file, not assumed from conversation memory.

### 2. Plan the Sessions (fresh start only)

Break the spec into an ordered list of Sessions:

- Prefer the spec's own phase/section boundaries where it already defines them (several specs in this repo do — e.g. `unit-normalisation.md`'s Phase 1–4).
- Otherwise split by dependency layer (schema before the logic that reads it, backend before the frontend that consumes it) or by shippable feature slice.
- Order the list so each Session depends only on earlier ones — a straight line, not a graph — so step 3 can always just take the first Session not yet `done`.
- Every requirement in the spec must land in exactly one Session: nothing left unassigned, nothing invented the spec didn't ask for.

Create branch `implement/<spec-slug>`. Call `EnterPlanMode`, present the Session breakdown, then `ExitPlanMode` to get the user's approval before writing any code — this is the only point in the run that stops for sign-off on scope; everything after executes without pausing unless a Session hits a blocked gate (step 3). Once approved, write the initial state file (format below), every Session `status: pending`, overall `status: planned`.

Completion criterion: every spec requirement mapped to exactly one Session; user has approved the breakdown; state file written to disk.

### 3. Work the next pending Session

Take the first Session not marked `done`.

1. **Implement** — write the code for that Session's scope only. Don't reach into a later Session's work even if it'd be convenient now; that's what the next Session is for.
2. **Test gate** — run this repo's relevant test suite (see `CLAUDE.md`'s "How to run and test the app") for what the Session touched, then invoke the `verify` skill to exercise the change end-to-end. Loop fixes until both are green.
3. **Review gate** — invoke the `code-review` skill, passing the commit the Session branched from (the previous Session's commit, or the branch point for Session 1) as the fixed point. Fix every `CONFIRMED` finding. Anything you disagree with or defer instead, say so to the user explicitly and record the outcome — don't silently drop it.
4. **Commit** the Session's work, message naming the Session.
5. **Checkpoint** — update the state file: this Session's `status: done`, its commit SHA, a one-line summary, the test/review outcome, and the overall `status: in-progress` (it starts `planned` and only becomes `in-progress` once a Session actually lands). Write it to disk before moving on — this is what makes the run resumable if the conversation ends right here.

If a Session can't clear either gate without a decision only the user can make, set its `status: blocked`, write a one-line note of exactly what's needed, checkpoint the state file, and stop — ask directly rather than guessing past it.

Completion criterion: the Session is green on both gates, committed, and the state file reflects `done` on disk.

### 4. Loop or finish

Any Session still `pending` → back to step 3. Every Session `done` → step 5. (Resuming a spec where every Session is already `done` but no PR exists yet → skip straight to step 5.)

### 5. Gather evidence and open the PR

**A completed spec always ends in a PR** — never in "committed on the branch, tell me when you want it raised". See CLAUDE.md's "Shipping work: pull requests" for the repo-wide rules; this step is the implement-specific version of them.

See [EVIDENCE.md](./EVIDENCE.md) for what counts as evidence and how to capture it — the rest of this skill doesn't need that detail, this one step does. **If any Session touched a user-visible surface, screenshots are required, not optional**: capture the golden path the spec describes, in the running app. Only a spec with no visible surface at all ships on metadata alone.

Push the branch, then `gh pr create` with a body containing: a summary of what the spec asked for and what shipped, a Session-by-session checklist, the gathered evidence, and links to any [Notion board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8) rows opened along the way. Anything noticed but not fixed during the run becomes a `backlog` row on the board — never a note in the PR body alone, and never an addition to the frozen `follow-ups.md`. If the spec itself has a board row, move it to `done` at the same time.

Set the state file's `status: complete` with the PR URL, then move the spec and its state file into `specs/completed/` — matching this repo's existing convention for finished specs.

Completion criterion: PR open and linked from the state file; state file `status: complete`; spec relocated.

### 6. Drive the PR to green

The run isn't over when the PR opens. Watch its checks to a conclusion:

```bash
gh pr checks --watch
```

- **Anything red is still your work.** `gh run view <run-id> --log-failed`, find the cause, fix it, push, watch again. Loop until `build-lint-test` and `e2e` are both green. Go back to the user only if a failure needs a decision genuinely theirs — a product call or a deliberate behaviour change — and say exactly what failed and what you tried. Don't re-run a flaky-looking e2e failure hoping it passes; the suite wipes its volumes every run, so failures are real.
- **A merge conflict is handled automatically, not reported.** If `gh pr view --json mergeable,mergeStateStatus` shows a conflict, `git fetch origin master && git rebase origin/master`, resolve, `git push --force-with-lease` — then re-watch the checks, since they last ran against a commit that no longer exists. Stop and ask only if a resolution is a real judgement call about behaviour rather than a mechanical overlap.
- **Then report back**: checks green, the PR URL, and anything that had to be fixed to get there.

If a rebase or a fix lands new commits, update the state file's Session `Commit:` SHAs so it still describes what is actually on the branch — and re-check any commit-pinned evidence URL from step 5, since a rebase rewrites the SHA it points at.

Completion criterion: every required check green on the PR's current head, and the user told so.

### 7. Merge — only when the user says so

Never merge on your own initiative; the spec being finished and the checks being green is not permission. When the user does ask, all three steps, in order:

```bash
gh pr merge <n> --squash
git checkout master && git pull origin master
git branch -d implement/<spec-slug>
```

Resyncing `master` and deleting the branch are part of the task, not tidying to be skipped — the next spec's branch gets cut from whatever `master` is left behind. `-d` rather than `-D` deliberately: a refusal means something is off and is worth reading.

## State file format

`specs/<spec-name>.state.md`, sibling to the spec:

```markdown
---
spec: specs/<spec-name>.md
status: planned | in-progress | complete
branch: implement/<spec-slug>
pr: <url, once opened>
---

## Session 1: <title>
Status: pending | done | blocked
Scope: <what part of the spec this covers>
Depends on: <earlier session, or none>
Commit: <sha, once done>
Notes: <test/review outcome, blocked reason, anything the next session needs to know>

## Session 2: <title>
...
```

## Why a state file, not conversation memory

A spec big enough to need multiple Sessions is big enough to outlast one conversation — context gets compacted, the conversation ends, the user comes back tomorrow. The state file is the only thing that survives that gap. Checkpoint it after *every* Session, not just at the end, and always re-read it at step 1 rather than trusting anything remembered from earlier in the current conversation.

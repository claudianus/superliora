---
name: conductor-job-desk-wake
description: "One-pass job-desk wake routing for Conductor: inbox/inspect, needs_user, verify done-claims, chain follow-ups, stop."
whenToUse: "On [job desk wake] or when <conductor_job_desk> lists unread notices / Next move. Use instead of re-exploring code or re-running verification on the interactive lane."
type: prompt
source: auto
risk: low
---

# Conductor job-desk wake (one pass)

## Goal
Route terminal job notices without redoing worker work or running builds/tests on the Conductor lane.

## Steps
1. **Digest 1** — if the inbox is noisy, fold with desk digest (manual) so the turn sees one escalation card; JobList for the live board. Do not open an Inbox marathon.
2. **JobInspect 1** — inspect only the highest-severity notice that needs a decision (not every unread / historical done).
3. **Route:**
   - `needs_user` → AskUserQuestion with evidence; stop.
   - done-claim vs brief: trust ledger fields (verification, result, sha, review_chain). If staffed wrong / no code / checks not run but claim is incomplete → JobCreate reframe with parent_job_id and smaller scope. Do not re-verify by running tests yourself.
   - failed / timeout → diagnose from that one JobInspect; reframe with JobCreate(continue_from_job_id=…) when the same deliverable continues (reuses worktree/resume), else smaller cold JobCreate or escalate with evidence. Stop blind retries.
   - Plan Desk completed → JobInspect 1 Implement handoff → JobCreate from those fields (copy `test_seams` / `tdd_mode` when present; greenfield_chain when delivery_mode=greenfield); do not invent a fresh brief from memory.
   - Wayfinder fog: if the plan summary still has a non-empty `## Not yet specified` that blocks the finish line, do **not** JobCreate(implement) — EnterPlanMode / explore to clear decisions first.
4. **ACK** board deltas (job_id — title — state). End turn.

## Must not
- Builds, tests, verification loops, long RepoQuery/Grep marathons on this lane
- Reciting the desk injection without acting
- Polling workers; results arrive via inbox
- Grilling / interview marathons on this lane (Plan Desk owns that)

## Related routing
Unknown multi-file discovery → JobCreate(kind=explore). Multi-approach design → EnterPlanMode.

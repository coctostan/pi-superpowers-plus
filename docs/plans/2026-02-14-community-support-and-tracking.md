# Community Support + Tracking (Roadmap/Contributing/Issues) Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add lightweight community/support infrastructure: ROADMAP, CONTRIBUTING, and GitHub Issue templates with strict routing (questions → Discussions; bugs/features → Issues).

**Architecture:** Pure repo-configuration + documentation change. Add Markdown docs at repo root and GitHub Issue Forms under `.github/ISSUE_TEMPLATE/` with blank issues disabled and a contact link to Discussions.

**Tech Stack:** GitHub Discussions + GitHub Issue Forms (YAML), Markdown, existing npm/vitest test script for sanity.

---

### Task 1: Prep an isolated branch

**Files:**
- Modify: none

**Step 1: Ensure clean working tree**

Run: `git status --porcelain`
Expected: no output

**Step 2: Create a new branch for this work**

Run:
```bash
git fetch origin
# base off main (or latest default branch)
git switch main
git pull --ff-only
git switch -c chore/community-support
```
Expected: new branch checked out

**Step 3: Verify branch**

Run: `git rev-parse --abbrev-ref HEAD`
Expected: `chore/community-support`

---

### Task 2: Add root `ROADMAP.md`

**Files:**
- Create: `ROADMAP.md`

**Step 1: Create `ROADMAP.md`**

Create a version-agnostic roadmap skeleton with:
- short disclaimer (directional)
- links to `CHANGELOG.md`, `docs/plans/`
- strict routing (Questions → Discussions; Bugs/Features → Issues)
- tracking links (Discussions; new issue; issue label queries)
- sections: Now / Next / Later
- tag legend: [user] [maintainer] [docs] [infra] [breaking?]

**Step 2: Sanity-check formatting**

Run: `rg -n "^# Roadmap" ROADMAP.md`
Expected: title present

**Step 3: Commit**

Run:
```bash
git add ROADMAP.md
git commit -m "docs: add roadmap"
```

---

### Task 3: Add root `CONTRIBUTING.md`

**Files:**
- Create: `CONTRIBUTING.md`

**Step 1: Create `CONTRIBUTING.md`**

Include:
- Strict routing:
  - Questions/support → Discussions
  - Bugs → Issues
  - Feature requests → Issues
  - Note that question-issues may be closed and redirected
- How to report bugs (expected/actual, repro steps, environment)
- How to request features (problem-first)
- Dev setup:
  - `npm install`
  - `npm test`
- PR guidelines checklist:
  - small PRs
  - tests when behavior changes
  - docs updates if user-facing
  - link related issues

**Step 2: Commit**

Run:
```bash
git add CONTRIBUTING.md
git commit -m "docs: add contributing guide"
```

---

### Task 4: Add GitHub Issue Forms (bug + feature) and disable blank issues

**Files:**
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`

**Step 1: Create `.github/ISSUE_TEMPLATE/config.yml`**

- `blank_issues_enabled: false`
- Add `contact_links` pointing questions/support to Discussions

**Step 2: Create bug report form (`bug_report.yml`)**

Minimal but structured GitHub Issue Form:
- auto-label: `bug`
- required fields:
  - What happened?
  - Steps to reproduce
  - Expected vs actual
  - Environment (OS, Node, pi version)
- optional:
  - Logs / screenshots

**Step 3: Create feature request form (`feature_request.yml`)**

Minimal but structured form:
- auto-label: `enhancement`
- required:
  - Problem / user story
  - Proposed change
- optional:
  - Alternatives
  - Willing to PR? (checkbox)

**Step 4: Validate YAML is parseable (best-effort)**

Try one of these (whichever exists):
- `python -c "import yaml,sys; yaml.safe_load(open('.github/ISSUE_TEMPLATE/bug_report.yml'))"`
- or `ruby -ryaml -e "YAML.load_file('.github/ISSUE_TEMPLATE/bug_report.yml')"`

Expected: no output, exit code 0

**Step 5: Commit**

Run:
```bash
git add .github/ISSUE_TEMPLATE
git commit -m "chore: add github issue templates"
```

---

### Task 5: Sanity verification

**Files:**
- Modify: none

**Step 1: Run repo tests (sanity)**

Run: `npm test`
Expected: PASS

**Step 2: Review git diff**

Run: `git show --stat`
Expected: only roadmap/contributing/.github templates

---

### Task 6: Optional: Add links from README to Issues/Discussions/Roadmap (only if desired)

**Files:**
- Modify: `README.md`

**Step 1: Decide whether to add a “Support” section**

If desired, add a small section linking to:
- Discussions for questions
- Issues for bugs/features
- Roadmap

**Step 2: Commit (if applied)**

Run:
```bash
git add README.md
git commit -m "docs: link to support channels"
```

---

## Notes
- This plan intentionally does **not** use TDD (no production code changes). Verification focuses on YAML validity + existing test suite sanity.

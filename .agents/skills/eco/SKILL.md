---
name: eco
description: High-efficiency operating mode for the Nihongo Loop repository.
---

# eco

Use this skill for general Nihongo Loop repository work when maximum quota and token economy is required without sacrificing technical quality.

## Core behavior

Apply automatically to every task:

- Make the smallest safe change that fully resolves the request.
- Work continuously until the requested scope is complete.
- Do not send plans, reasoning, long explanations, intermediate reports, progress updates, large diffs, or complete files.
- Do not perform broad audits, redundant searches, speculative refactors, unrelated cleanup, or repeated procedures.
- Investigate first only the directly cited files, functions, errors, and logs.
- Use targeted `rg` searches and open only relevant snippets.
- Do not read `node_modules`, `dist`, lockfiles, coverage, generated files, or large files unless directly necessary.
- Do not create parallel paths, new abstractions, dependencies, migrations, deployment changes, secrets, IAM, Cloud Run changes, or database changes outside the explicit scope.
- For broad tasks, organize dependencies internally and continue without asking approval between phases.
- Use proportional validation: run the closest focused test first; expand only when needed.
- Do not run `npm test`, build, E2E, load tests, deploy, scans, dependency installation, paid tests, or full suites unless explicitly requested or strictly required.
- Never repeat a command or test when no relevant file changed.
- Use mocks and fakes for Gemini and other paid providers.
- Never call paid AI in normal tests.
- For AI and queue code: validate the job before calling AI, do not process cancelled or obsolete jobs, do not duplicate jobs, do not automatically re-enqueue terminal failures, and do not send excessive context.
- Do not commit, push, deploy, or alter secrets unless explicitly requested.
- Always run `git diff --check` once before the final response.
- If blocked, respond only with the exact cause and required action.

## Internal modes

### 1. Simple Fix

Locate the direct code, make the minimum edit, run the closest relevant test, run `git diff --check`, then stop.

### 2. Medium Change

Follow direct dependencies, make only connected changes, run targeted tests, and run lint or typecheck only when relevant.

### 3. Large Task

Reuse the provided diagnosis, work continuously, validate only high-risk boundaries, and run the full suite only near the end.

## Final response format

Final responses must have at most 6 lines and exactly this shape:

```text
Status:
Changed:
Validation:
Commit:
Push:
Blocker:
```

# Invocation and default execution

When this skill is active, apply these defaults automatically to every task:

- Make the smallest safe change that fully resolves the request.
- Work continuously until the requested scope is complete.
- Do not send intermediate reports, plans, explanations, or progress updates.
- Do not perform broad audits, unrelated repository searches, speculative refactors, or redundant procedures.
- Use proportional validation: the narrowest useful test first; expand only when necessary.
- Do not run expensive, paid, destructive, deployment, E2E, load, full-suite, or repeated tests unless explicitly requested or strictly required.
- Use mocks/fakes instead of paid AI providers.
- Reply only in the skill’s final-response format.

The user only needs to write:

```text
$eco [pedido]
````

No extra instruction is needed unless the user wants to override a default, such as requesting a full audit, deployment, commit, push, E2E, load testing, or a detailed report.

```

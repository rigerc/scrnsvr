---
name: leitfaden
description: Use Leitfaden to inspect and manage project work from idea to done.
---

# Leitfaden

Use Leitfaden as the source of truth for project work. Never guess projects,
work items, or revisions — resolve them from Leitfaden first.

## Project selection

Project creation requires explicit user authorization. Never create a project
unless the user clearly asks for a new project. Requests for a new epic, task,
or subtask in, for, or under a named project refer to that existing project.

Resolve every project destination through Leitfaden MCP lookup; never guess
IDs or infer the project from local files.

Before creating child work:

1. Honor a user-specified project (typed ID, name, or workspace path) after
   confirming it via MCP lookup; never substitute another project.
2. Otherwise prefer the project linked to the current workspace path; fall back
   to matching the project name separately from the proposed work-item topic.
3. Reuse the matched project when exactly one project matches.
4. Ask the user to choose when multiple projects match.
5. Ask before creating a project when no project matches. A topic-only match
   miss never authorizes project creation.

## Work management

Projects break down into epics, epics into tasks, and tasks into subtasks.
Use that nesting for decomposition, and use ordering links only to express
what must happen first. Do not substitute one for the other.

Statuses are `not_started`, `in_progress`, `blocked`, `done`, and `cancelled`.
Priorities are `low`, `medium`, `high`, and `urgent`. Change state explicitly
for state transitions and record progress notes separately; one is not a
substitute for the other.

1. Set scope — clarify whether the request is to inspect, propose a plan,
   or apply a change.
2. Inspect enough context — look for existing work before creating anything
   new, read the exact item before changing it, and check readiness,
   blockers, and ordering first.
3. Make the smallest change that fulfills the request — one focused change
   per item, preserving fields and relationships you were not asked to touch.
4. Verify — re-read affected work after changing it when confirmation matters.
5. Report outcome — summarize what changed, what remains blocked, and what
   failed, concisely and without dumping raw responses.

Reading or planning never authorizes a change. Preserve what you were not
asked to change. Do not invent reasons or narrative. Archive or delete only
exactly what was requested, never related work.

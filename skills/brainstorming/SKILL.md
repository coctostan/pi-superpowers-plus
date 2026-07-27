---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

> **Related skills:** Consider `/skill:using-git-worktrees` to set up an isolated workspace, then `/skill:writing-plans` for implementation planning.

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

## Boundaries
- Read code and docs: yes
- Write to docs/superpowers/specs/: yes
- Edit or create any other files: no

## The Process

**Before anything else — check git state:**
- Run `git status` and `git log --oneline -5`
- If on a feature branch with uncommitted or unmerged work, ask the user:
  - "You're on `<branch>` with uncommitted changes. Want to finish/merge that first, stash it, or continue here?"
- Require exactly one of: finish prior work, stash, or explicitly continue here
- If the topic is new, suggest creating a new branch before brainstorming

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- Check if the codebase or ecosystem already solves this before designing from scratch
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**
- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## After the Design

**Documentation:**
- Write the validated design to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Commit the design document to git
- Mark the brainstorm phase complete: call `plan_tracker` with `{action: "update", status: "complete"}` for the current phase

**Implementation (if continuing):**
- Ask: "Ready to set up for implementation?"
- Set up isolated workspace — `/skill:using-git-worktrees` for larger work, or just create a branch for small changes
- Use `/skill:writing-plans` to create detailed implementation plan

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Design for testability** - Favor approaches with clear boundaries that are easy to verify with TDD
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense

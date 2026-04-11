---
name: frontend-design
version: 2.0.0
description: "Guide for building frontend UIs, web pages, dashboards, and any user-facing interface with intentional design (not AI slop). Also covers creating and maintaining DESIGN.md files — the universal design language that captures a project's complete visual identity (colors, typography, spacing, layout, components) in structured markdown. Use when: building HTML pages, landing pages, dashboards, web apps, creating a design system, extracting design tokens, making a DESIGN.md, auditing design consistency, or any task involving a project's visual language."
---

# Frontend Design

This skill covers two areas: building UIs that look crafted (not generated), and managing DESIGN.md design system files.

## Routing

| When the task involves...                                                                                                             | Load                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Building frontend UIs, web pages, dashboards, components, CSS, layouts, responsive design, accessibility                              | [building.md](building.md)   |
| Creating, reading, applying, evolving, or auditing DESIGN.md files; extracting design tokens; translating tokens to framework configs | [design-md.md](design-md.md) |

**Both apply?** Load both. When a DESIGN.md exists in the project, its tokens override the general principles in building.md.

## Companion Skill

For concrete rule-level UI values (animation timings, easing curves, spring params, Laws of UX target sizes, typography features, shadow/radius math, prefetching patterns), also load the [userinterface-wiki](../userinterface-wiki/SKILL.md) skill. frontend-design sets direction; userinterface-wiki provides the 152 prioritized rules with code examples.

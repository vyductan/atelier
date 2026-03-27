# @acme Shared Packages

This directory contains the shared packages and workspace tooling used by Atelier.

## Included packages

- [`ui/`](ui/) — shared React UI components and styling primitives
- [`eslint-config/`](eslint-config/) — shared ESLint configuration
- [`prettier-config/`](prettier-config/) — shared Prettier configuration
- [`tsconfig/`](tsconfig/) — shared TypeScript configuration presets
- [`github/`](github/) — shared GitHub automation and workflow helpers

## When to look here

Use this workspace when you need to:

- update reusable UI components
- change shared linting, formatting, or TypeScript rules
- adjust shared GitHub workflows or automation

For package-specific conventions, check the `AGENTS.md` file inside the relevant subdirectory when present.

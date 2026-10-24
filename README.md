# advui

Single-page advanced chat UI built with Svelte 5 and Vite 8, using Rolldown and Oxc for bundling and minification.

## Features

- Multi-chat sidebar with search and quick actions
- Branching/variant message graph workflow
- Preset and connection management in-app
- Local persistence with IndexedDB fallback handling
- Single active tab per origin to prevent concurrent chat edits
- Chat/data import and export tools

## Requirements

- Node.js 22.12+ on the 22.x line, Node.js 24.x, or Node.js 26+
- Bun 1.4.4+ for package management and running scripts
- A browser with Web Locks support, served over HTTPS or localhost

## Quick Start

```bash
bun install --frozen-lockfile
bun run dev
```

Open the local URL shown by Vite.

Dependencies are locked in `bun.lock`. Use `bun add` / `bun remove` to change dependencies and commit the updated lockfile. Vite and Vitest run on Node.js; Bun manages packages and invokes their scripts.

## Scripts

- `bun run dev` - start local development server
- `bun run build` - production build as a single HTML file
- `bun run preview` - preview the production build
- `bun run test` - run Vitest in watch mode
- `bun run test --run` - run the test suite once
- `bun run test:ui` - run tests with Vitest UI
- `bun run test:coverage --run` - run tests with coverage
- `ANALYZE=1 bun run build` - build and write bundle analysis to `stats.json`

Use `bun run test` rather than `bun test`: the suite uses Vitest and its happy-dom environment.

## Project Layout

- `src/App.svelte` - top-level shell and chat mounting logic
- `src/lib/Chat.svelte` - chat container/state orchestration
- `src/lib/components/` - reusable UI components
- `src/lib/chat/` - chat actions and service modules
- `src/lib/utils/` - shared helpers and persistence utilities

## Cloudflare Pages Hook

- Local hook path: `.githooks/pre-push`
- Trigger: push `master` to remote `publish` (override with `CF_DEPLOY_REMOTE`)
- It runs tests, builds, then deploys `dist/` from your machine using Wrangler.
- Setup:
  - `git config core.hooksPath .githooks`
  - optional: `cp .env.deploy.example .env.deploy` and fill credentials
- Auth mode:
  - if `.env.deploy` has token/account, deploy uses those
  - otherwise deploy uses your existing local Wrangler login/token
- Required in `.env.deploy`:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - optional `CLOUDFLARE_PAGES_PROJECT` (defaults to `advui`)
  - optional `CLOUDFLARE_PAGES_BRANCH` (defaults to `main`, your production branch)
- Manual deploy command:
  - `bun run build && bun run deploy:pages`

# advui

Single-page advanced chat UI built with Svelte 5 and Vite.

## Features

- Multi-chat sidebar with search and quick actions
- Branching/variant message graph workflow
- Preset and connection management in-app
- Local persistence with IndexedDB fallback handling
- Chat/data import and export tools

## Requirements

- Node.js 20+
- npm 10+

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Scripts

- `npm run dev` - start local development server
- `npm run build` - production build
- `npm run preview` - preview the production build
- `npm test` - run tests
- `npm run test:ui` - run tests with Vitest UI
- `npm run test:coverage` - run tests with coverage

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
  - `npm run build && npm run deploy:pages`

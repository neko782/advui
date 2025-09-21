# Svelte + Vite

This app has been refactored into atomic Svelte components. The Chat UI is now composed of small, reusable pieces with clear data/event flow.

Component map (under `src/lib`):
- `components/chat/Composer.svelte` – input area, send and add-as menus, per-chat settings popover
- `components/chat/MessageList.svelte` – scrollable list of visible messages
- `components/chat/MessageItem.svelte` – one message row (meta, bubble, actions)
- `components/chat/MessageMeta.svelte` – role badge + change-role menu
- `components/chat/MessageBubble.svelte` – message content or inline editor
- `components/chat/MessageActions.svelte` – copy, delete, edit, move, regenerate, variants
- `components/common/IconButton.svelte` – consistent icon button wrapper
- `components/common/SendMenu.svelte` – generic hover/focus popover container
- `utils/dom.js` – `autoGrow`, `placeCaretAtEnd`
- `utils/clipboard.js` – `copyText`
- `utils/format.js` – `formatRole`
- `utils/markdown.js` – `renderMarkdown`

Stateful container: `src/lib/Chat.svelte` retains branching logic, API calls, and state. Children communicate via props and events.

## Settings

- Global settings include a “Default Chat” section where you can set the default model. This applies to every new chat.
- Per-chat settings (like model) are grouped and can be adjusted from the tune (chat settings) button near the composer.


## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).

## Need an official Svelte framework?

Check out [SvelteKit](https://github.com/sveltejs/kit#readme), which is also powered by Vite. Deploy anywhere with its serverless-first approach and adapt to various platforms, with out of the box support for TypeScript, SCSS, and Less, and easily-added support for mdsvex, GraphQL, PostCSS, Tailwind CSS, and more.

## Technical considerations

**Why use this over SvelteKit?**

- It brings its own routing solution which might not be preferable for some users.
- It is first and foremost a framework that just happens to use Vite under the hood, not a Vite app.

This template contains as little as possible to get started with Vite + Svelte, while taking into account the developer experience with regards to HMR and intellisense. It demonstrates capabilities on par with the other `create-vite` templates and is a good starting point for beginners dipping their toes into a Vite + Svelte project.

Should you later need the extended capabilities and extensibility provided by SvelteKit, the template has been structured similarly to SvelteKit so that it is easy to migrate.

**Why `global.d.ts` instead of `compilerOptions.types` inside `jsconfig.json` or `tsconfig.json`?**

Setting `compilerOptions.types` shuts out all other types not explicitly listed in the configuration. Using triple-slash references keeps the default TypeScript setting of accepting type information from the entire workspace, while also adding `svelte` and `vite/client` type information.

**Why include `.vscode/extensions.json`?**

Other templates indirectly recommend extensions via the README, but this file allows VS Code to prompt the user to install the recommended extension upon opening the project.

**Why enable `checkJs` in the JS template?**

It is likely that most cases of changing variable types in runtime are likely to be accidental, rather than deliberate. This provides advanced typechecking out of the box. Should you like to take advantage of the dynamically-typed nature of JavaScript, it is trivial to change the configuration.

**Why is HMR not preserving my local component state?**

HMR state preservation comes with a number of gotchas! It has been disabled by default in both `svelte-hmr` and `@sveltejs/vite-plugin-svelte` due to its often surprising behavior. You can read the details [here](https://github.com/sveltejs/svelte-hmr/tree/master/packages/svelte-hmr#preservation-of-local-state).

If you have state that's important to retain within a component, consider creating an external store which would not be replaced by HMR.

```js
// store.js
// An extremely simple external store
import { writable } from 'svelte/store'
export default writable(0)
```

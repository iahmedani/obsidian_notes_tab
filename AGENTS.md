# Obsidian Tabbed Containers Plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript -> bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, `styles.css`.

## What this plugin does

Provides a `tabs` fenced code block processor that renders interactive tabbed containers in notes. Users can add, delete, rename, and reorder tabs via the UI — all changes write back to the Markdown source. Each tab's content is rendered through `MarkdownRenderer.render()` with proper lifecycle binding so that native features (task checkboxes, wikilinks, Dataview, embeds) work inside tabs.

### User syntax

```markdown
```tabs
--- Tab Title 1
Markdown content

--- 📋 Tab Title 2
More content with emoji icon
```
```

### Key files

| File | Responsibility |
|---|---|
| `src/main.ts` | Plugin lifecycle, `registerMarkdownCodeBlockProcessor("tabs", ...)`, tab parser/serializer, `TabbedContainerComponent` (extends `MarkdownRenderChild`), source editing via `updateSourceBlock()` |
| `src/settings.ts` | `TabbedContainersSettings` interface (`tabStyle`: underline or pill), defaults, `TabbedContainersSettingTab` |
| `styles.css` | Theme-adaptive CSS using Obsidian custom properties. Two style variants: underline (default) and pill. No hardcoded colors. |
| `manifest.json` | Plugin ID: `obsidian-tabbed-containers` |

## Environment & tooling

- Node.js: v16+ (LTS recommended).
- Package manager: npm.
- Bundler: esbuild (`esbuild.config.mjs`).
- Types: `obsidian` type definitions.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Architecture notes

### Rendering pipeline (core principle)

The critical design pattern is the three-part binding in `TabbedContainerComponent`:

1. **`MarkdownRenderer.render(app, content, el, sourcePath, this)`** — `this` is the `MarkdownRenderChild`, so all child components (Dataview, embeds) are registered as children and cleaned up on unload.
2. **`ctx.addChild(component)`** — Ties our component to Obsidian's rendering context lifecycle.
3. **`sourcePath` passthrough** — Forwarded from `MarkdownPostProcessorContext` so task toggles update the correct source file and wikilinks resolve relative to the current note.

This three-part binding is what makes tab content a "first-class citizen" — the core principle of this plugin.

### Source editing pipeline (interactive features)

All UI actions (add, delete, rename, reorder tabs, content drops) modify the in-memory `tabs` array, then call `persistTabs()`:

1. `serializeTabs(tabs)` — reconstructs the `--- Title\ncontent` format
2. `ctx.getSectionInfo(el)` — locates the code block's line range in the source file
3. `app.vault.modify(file, newContent)` — writes the updated content
4. Obsidian automatically re-renders the code block after the file is modified

### Tab parsing

`parseTabs(source)` splits the code block content on lines matching `/^---\s+(.+)$/`. Tab titles support an optional emoji prefix: `--- 📋 Tasks` → icon="📋", title="Tasks".

### Drag-and-drop architecture

Two separate drag systems coexist:

1. **Tab reordering** — uses a custom MIME type (`application/x-tabbed-container-reorder`) to avoid conflicts with content drops.
2. **Content drops** — accepts `text/plain` (including Obsidian internal wikilink drags) and file drops (converted to `![[filename]]` embeds).

The content drop zone ignores any drag event that includes the custom reorder MIME type.

### Style variants

The `tabStyle` setting applies a CSS class on the container:
- `tabbed-container--underline` — animated bottom border indicator
- `tabbed-container--pill` — filled background on active tab, indicator hidden

## File & folder conventions

- Source lives in `src/`. Keep `main.ts` focused on plugin lifecycle and the core code block processor.
- Do not commit build artifacts: `node_modules/`, `main.js`.
- Generated output (`main.js`) goes to the project root for Obsidian to load.

## Manifest rules (`manifest.json`)

- `id`: `obsidian-tabbed-containers` — never change after release.
- `minAppVersion`: `0.15.0`.
- Keep `minAppVersion` accurate when using newer APIs.

## Testing

Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` to:

```
<Vault>/.obsidian/plugins/obsidian-tabbed-containers/
```

Reload Obsidian and enable the plugin in **Settings > Community plugins**.

## Coding conventions

- TypeScript with strict null checks enabled.
- Keep `main.ts` focused: plugin lifecycle + code block processor + component class + source editing.
- Use Obsidian's `register*` helpers for cleanup.
- Use Obsidian CSS custom properties for all colors — never hardcode.
- Use `setIcon()` from Obsidian API for icons — never use `innerHTML` for SVG.
- Vanilla DOM manipulation preferred. No framework dependencies.
- `async/await` over promise chains.

## Security & privacy

- No network requests. Fully offline.
- No telemetry or analytics.
- No vault content is read beyond what Obsidian's rendering pipeline and `getSectionInfo()` need.
- All DOM listeners and components are cleaned up via `MarkdownRenderChild` lifecycle.

## Performance

- Startup is lightweight: only registers a code block processor and a command.
- Tab content is rendered on demand (only the active tab).
- No vault scans or file system watchers.

## Agent do/don't

**Do**
- Use `MarkdownRenderer.render()` with proper `sourcePath` and `component` params.
- Register components via `ctx.addChild()` for lifecycle management.
- Use Obsidian CSS variables for all visual styling.
- Use `setIcon()` for any icon rendering.
- Use the custom MIME type constant `TAB_REORDER_MIME` for drag-and-drop reordering.
- Use `ctx.getSectionInfo()` + `vault.modify()` for source editing.
- Keep command IDs stable (`insert-tabs-template`).

**Don't**
- Use `innerHTML` for any content rendering.
- Hardcode colors or font sizes.
- Add network calls or external service dependencies.
- Skip lifecycle registration — always use `ctx.addChild()` and `MarkdownRenderChild`.
- Use `text/plain` MIME for tab reorder drags (use the custom type instead).

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json`.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version` (no `v` prefix).
- Attach `manifest.json`, `main.js`, and `styles.css` to the release.

## References

- Obsidian API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

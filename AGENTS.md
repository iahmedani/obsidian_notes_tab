# Obsidian Tabbed Containers Plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript -> bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, `styles.css`.

## What this plugin does

Provides a `tabs` fenced code block processor that renders embedded tabbed containers in notes. Each tab's Markdown is rendered through `MarkdownRenderer.render()` with proper lifecycle binding so that native features (task checkboxes, wikilinks, Dataview, embeds) work inside tabs.

### User syntax

```markdown
```tabs
--- Tab Title 1
Markdown content

--- Tab Title 2
More content
```
```

### Key files

| File | Responsibility |
|---|---|
| `src/main.ts` | Plugin lifecycle, `registerMarkdownCodeBlockProcessor("tabs", ...)`, tab parser, `TabbedContainerComponent` (extends `MarkdownRenderChild`) |
| `src/settings.ts` | `TabbedContainersSettings` interface, defaults, `TabbedContainersSettingTab` |
| `styles.css` | Theme-adaptive CSS using Obsidian custom properties. No hardcoded colors. |
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

### Rendering pipeline

The critical design pattern is the three-part binding in `TabbedContainerComponent`:

1. **`MarkdownRenderer.render(app, content, el, sourcePath, this)`** — `this` is the `MarkdownRenderChild`, so all child components (Dataview, embeds) are registered as children and cleaned up on unload.
2. **`ctx.addChild(component)`** — Ties our component to Obsidian's rendering context lifecycle.
3. **`sourcePath` passthrough** — Forwarded from `MarkdownPostProcessorContext` so task toggles update the correct source file.

### Tab parsing

`parseTabs(source)` splits the code block content on lines matching `/^---\s+(.+)$/`. Everything between delimiters becomes that tab's Markdown content.

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
- Keep `main.ts` minimal: plugin lifecycle + code block processor + component class.
- Use Obsidian's `register*` helpers for cleanup.
- Use Obsidian CSS custom properties for all colors — never hardcode.
- Vanilla DOM manipulation preferred. No framework dependencies.
- `async/await` over promise chains.

## Security & privacy

- No network requests. Fully offline.
- No telemetry or analytics.
- No vault content is read beyond what Obsidian's rendering pipeline needs.
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
- Keep command IDs stable (`insert-tabs-template`).

**Don't**
- Use `innerHTML` or manual HTML string construction for Markdown content.
- Hardcode colors or font sizes.
- Add network calls or external service dependencies.
- Skip lifecycle registration — always use `ctx.addChild()` and `MarkdownRenderChild`.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json`.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version` (no `v` prefix).
- Attach `manifest.json`, `main.js`, and `styles.css` to the release.

## References

- Obsidian API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

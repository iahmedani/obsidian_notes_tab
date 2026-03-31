# Obsidian Tabbed Containers

Create elegant, embedded tabbed containers directly within your Obsidian notes. Content inside tabs is rendered as **first-class Markdown** — task checkboxes, wikilinks, embeds, Dataview queries, and all other native Obsidian features work seamlessly.

![Obsidian](https://img.shields.io/badge/Obsidian-v0.15.0+-7C3AED)

## Features

### Interactive tab management
- **Add tabs** — click the `+` button in the tab bar to add a new tab instantly.
- **Delete tabs** — hover over a tab to reveal the `×` button; click to remove it.
- **Rename tabs** — double-click any tab title to rename it inline. Press `Enter` to confirm, `Escape` to cancel.
- **Icon/emoji support** — prefix your tab title with an emoji: `--- 📋 Tasks` renders the emoji as a tab icon.
- **Drag-and-drop reorder** — drag tabs within the bar to rearrange their order.
- **Drag-and-drop content** — drag text from your notes and drop it onto a tab's content area to append it.
- **3 tabs by default** — the "Insert tabs template" command creates 3 starter tabs.

### Rendering & theming
- **Native Markdown rendering** — content inside tabs goes through Obsidian's full rendering pipeline, so everything works: `[[wikilinks]]`, `![[embeds]]`, task checkboxes, callouts, Dataview, and more.
- **Task checkbox toggling** — checking/unchecking a task inside a tab updates the source file, just like in a normal note.
- **Source-synced editing** — all UI actions (add, delete, rename, reorder) write back to the Markdown source, so your notes stay portable and version-controllable.
- **Theme-adaptive styling** — inherits your active Obsidian theme via CSS custom properties (`--interactive-accent`, `--background-secondary`, etc.). No hardcoded colors.
- **Animated tab indicator** — smooth underline transition when switching tabs, inspired by Tailwind UI Tabs.

### Accessibility & polish
- **Keyboard accessible** — arrow keys to navigate tabs, `F2` to rename, `Delete` to remove, `Home`/`End` to jump. Proper ARIA roles throughout.
- **Responsive** — adapts to narrow panes and mobile viewports. Horizontally scrollable tab bar for many tabs.
- **Print-friendly** — clean print styles that show the active tab clearly.
- **Lightweight** — vanilla DOM manipulation, no framework dependencies. Minimal startup cost.

## Syntax

Use a fenced code block with the language identifier `tabs`. Each tab is defined by a `---` delimiter followed by the tab title:

````markdown
```tabs
--- Overview
This is the **overview** tab. Full Markdown is supported.

- Item one
- Item two

--- Tasks
- [ ] Review the PR
- [x] Write documentation
- [ ] Deploy to production

--- Links
Here are some useful links:

- [[Daily Note]]
- [[Project Alpha]]
- ![[Embedded Note]]

--- Data
```dataview
TABLE file.mtime AS "Modified"
FROM "Projects"
SORT file.mtime DESC
```
```
````

### Syntax rules

| Element | Format | Example |
|---|---|---|
| Code block language | `tabs` | `` ```tabs `` |
| Tab delimiter | `--- ` followed by title | `--- My Tab Title` |
| Tab with icon | `--- ` + emoji + title | `--- 📋 My Tab Title` |
| Tab content | Any valid Markdown | Paragraphs, lists, links, embeds, code blocks, etc. |

## Installation

### From Obsidian Community Plugins (recommended)

1. Open **Settings** > **Community plugins** > **Browse**.
2. Search for **Tabbed Containers**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/iahmedani/obsidian_notes_tab/releases).
2. Create a folder: `<YourVault>/.obsidian/plugins/obsidian-tabbed-containers/`
3. Copy the three files into that folder.
4. Reload Obsidian and enable the plugin in **Settings** > **Community plugins**.

## Commands

| Command | Description |
|---|---|
| **Insert tabs template** | Inserts a starter `tabs` code block at the cursor position. |

Open the command palette (`Ctrl/Cmd + P`) and search for "Insert tabs template".

## Settings

| Setting | Options | Default |
|---|---|---|
| Tab style | Underline / Pill | Underline |

Access via **Settings** > **Community plugins** > **Tabbed Containers**.

## Architecture

### Core principle: first-class Markdown rendering

The #1 problem with existing tab plugins is that content inside tabs doesn't behave like normal note content — task checkboxes don't toggle, wikilinks don't resolve, Dataview doesn't render. This plugin solves it with a three-part binding:

1. **`sourcePath`** — Passed from `MarkdownPostProcessorContext` to `MarkdownRenderer.render()`. This is how Obsidian knows which file to update when a task checkbox is toggled, and how wikilinks resolve relative to the current note.

2. **`this` (component)** — The `TabbedContainerComponent` extends `MarkdownRenderChild` (which extends `Component`). When passed as the lifecycle owner, all child components created during rendering (Dataview blocks, embedded queries, dynamic content) are registered as children. When the tab container is removed, `onunload()` cascades to all children — preventing memory leaks.

3. **`ctx.addChild(component)`** — Registers our component with Obsidian's rendering context. This ties the container's lifecycle to the note view itself, so cleanup happens automatically when the note is closed or the code block is re-rendered.

### Source-synced editing

All interactive UI actions write back to the Markdown source so notes remain portable and version-controllable:

```
  User action (rename, add, delete, reorder, content drop)
                       │
                       ▼
  Modify in-memory tabs[] array
                       │
                       ▼
  serializeTabs(tabs) → reconstruct "--- Title\ncontent" format
                       │
                       ▼
  ctx.getSectionInfo(el) → find code block line range in file
                       │
                       ▼
  app.vault.modify(file, newContent) → write to disk
                       │
                       ▼
  Obsidian auto-re-renders the code block
```

### Drag-and-drop architecture

Two drag systems coexist without conflict:

- **Tab reordering** uses a custom MIME type (`application/x-tabbed-container-reorder`) so it's cleanly distinguished from external drops.
- **Content drops** accept `text/plain` (including Obsidian internal wikilink drags from the file explorer) and file drops (converted to `![[filename]]` embeds). The drop zone ignores any drag carrying the custom reorder MIME.

### Style variants

The `tabStyle` setting applies a CSS modifier class on the container:

| Style | Class | Behavior |
|---|---|---|
| Underline | `tabbed-container--underline` | Animated bottom border indicator slides between tabs |
| Pill | `tabbed-container--pill` | Active tab gets a filled background using `--interactive-accent` |

### File structure

```
src/
  main.ts       # Plugin lifecycle, code block processor, TabbedContainerComponent, source editing
  settings.ts   # Settings interface (tabStyle), defaults, settings tab UI
styles.css      # Theme-adaptive CSS — underline + pill variants, drag cues, drop zones
manifest.json   # Plugin metadata
```

## Development

### Prerequisites

- Node.js v16+
- npm

### Setup

```bash
git clone https://github.com/iahmedani/obsidian_notes_tab.git
cd obsidian_notes_tab
npm install
```

### Development (watch mode)

```bash
npm run dev
```

This compiles `src/main.ts` to `main.js` and watches for changes.

### Production build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

### Testing in Obsidian

Copy the compiled files to your vault's plugin directory:

```bash
cp main.js styles.css manifest.json <YourVault>/.obsidian/plugins/obsidian-tabbed-containers/
```

Then reload Obsidian and enable the plugin.

## Releasing

1. Update the `version` field in `manifest.json`.
2. Run `npm version <patch|minor|major>` to sync `package.json` and `versions.json`.
3. Create a GitHub release with the version number as the tag (no `v` prefix).
4. Attach `main.js`, `styles.css`, and `manifest.json` to the release.

## License

[0-BSD](LICENSE)

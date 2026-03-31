import { MarkdownRenderChild, MarkdownRenderer, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, TabbedContainersSettings, TabbedContainersSettingTab } from "./settings";

/**
 * Parsed representation of a single tab within a tabbed container.
 */
interface ParsedTab {
	title: string;
	content: string;
}

/**
 * Parses the raw content of a ```tabs code block into individual tabs.
 *
 * Syntax:
 *   ```tabs
 *   --- Tab Title 1
 *   Content for tab 1 (full Markdown supported)
 *
 *   --- Tab Title 2
 *   Content for tab 2
 *   ```
 *
 * The delimiter is a line starting with `---` followed by the tab title.
 */
function parseTabs(source: string): ParsedTab[] {
	const tabs: ParsedTab[] = [];
	const lines = source.split("\n");

	let currentTitle: string | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		const match = line.match(/^---\s+(.+)$/);
		if (match) {
			// Flush previous tab
			if (currentTitle !== null) {
				tabs.push({
					title: currentTitle,
					content: currentLines.join("\n").trim(),
				});
			}
			currentTitle = match[1]!.trim();
			currentLines = [];
		} else {
			currentLines.push(line);
		}
	}

	// Flush last tab
	if (currentTitle !== null) {
		tabs.push({
			title: currentTitle,
			content: currentLines.join("\n").trim(),
		});
	}

	return tabs;
}

/**
 * A MarkdownRenderChild that manages the lifecycle of a single tabbed container.
 * This ensures that all child components (rendered Markdown, Dataview blocks, etc.)
 * are properly cleaned up when the container is removed from the DOM.
 */
class TabbedContainerComponent extends MarkdownRenderChild {
	private tabs: ParsedTab[];
	private sourcePath: string;
	private plugin: TabbedContainersPlugin;
	private activeIndex = 0;

	constructor(
		containerEl: HTMLElement,
		tabs: ParsedTab[],
		sourcePath: string,
		plugin: TabbedContainersPlugin,
	) {
		super(containerEl);
		this.tabs = tabs;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
	}

	override onload(): void {
		this.render();
	}

	private render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("tabbed-container");

		if (this.tabs.length === 0) {
			el.createEl("p", {
				text: "No tabs defined. Use --- Tab Title to create tabs.",
				cls: "tabbed-container-empty",
			});
			return;
		}

		// --- Tab bar ---
		const tabBar = el.createDiv({ cls: "tabbed-container-tab-bar" });
		const tabContentArea = el.createDiv({ cls: "tabbed-container-content" });

		// Animated underline indicator
		const indicator = tabBar.createDiv({ cls: "tabbed-container-indicator" });

		const tabButtons: HTMLElement[] = [];

		this.tabs.forEach((tab, index) => {
			const button = tabBar.createEl("button", {
				text: tab.title,
				cls: "tabbed-container-tab-button",
			});
			button.setAttribute("role", "tab");
			button.setAttribute("aria-selected", String(index === this.activeIndex));
			button.setAttribute("tabindex", index === this.activeIndex ? "0" : "-1");

			button.addEventListener("click", () => {
				this.switchTab(index, tabButtons, tabContentArea, indicator);
			});

			// Keyboard navigation
			button.addEventListener("keydown", (e: KeyboardEvent) => {
				let targetIndex = -1;
				if (e.key === "ArrowRight") {
					targetIndex = (index + 1) % this.tabs.length;
				} else if (e.key === "ArrowLeft") {
					targetIndex = (index - 1 + this.tabs.length) % this.tabs.length;
				} else if (e.key === "Home") {
					targetIndex = 0;
				} else if (e.key === "End") {
					targetIndex = this.tabs.length - 1;
				}

				if (targetIndex >= 0) {
					e.preventDefault();
					tabButtons[targetIndex]?.focus();
					this.switchTab(targetIndex, tabButtons, tabContentArea, indicator);
				}
			});

			tabButtons.push(button);
		});

		// Render the initially active tab
		this.renderTabContent(this.activeIndex, tabContentArea);
		this.updateActiveStates(tabButtons);

		// Position indicator after DOM is ready
		requestAnimationFrame(() => {
			this.positionIndicator(indicator, tabButtons);
		});
	}

	private switchTab(
		index: number,
		tabButtons: HTMLElement[],
		contentArea: HTMLElement,
		indicator: HTMLElement,
	): void {
		if (index === this.activeIndex) return;

		this.activeIndex = index;
		this.updateActiveStates(tabButtons);
		this.positionIndicator(indicator, tabButtons);

		// Re-render content area
		contentArea.empty();
		this.renderTabContent(index, contentArea);
	}

	private updateActiveStates(tabButtons: HTMLElement[]): void {
		tabButtons.forEach((btn, i) => {
			const isActive = i === this.activeIndex;
			btn.toggleClass("is-active", isActive);
			btn.setAttribute("aria-selected", String(isActive));
			btn.setAttribute("tabindex", isActive ? "0" : "-1");
		});
	}

	private positionIndicator(indicator: HTMLElement, tabButtons: HTMLElement[]): void {
		const activeBtn = tabButtons[this.activeIndex];
		if (!activeBtn) return;

		indicator.style.left = `${activeBtn.offsetLeft}px`;
		indicator.style.width = `${activeBtn.offsetWidth}px`;
	}

	/**
	 * Renders a tab's Markdown content using Obsidian's native MarkdownRenderer.render().
	 *
	 * CRITICAL ARCHITECTURE DECISION:
	 * We pass `this` (a MarkdownRenderChild, which extends Component) as the
	 * `component` parameter. This means:
	 *
	 * 1. All child components created during rendering (Dataview blocks, embedded
	 *    queries, etc.) are registered as children of this component.
	 * 2. When the tabbed container is removed from the DOM, `onunload()` is called,
	 *    which cascades to all children — preventing memory leaks.
	 * 3. Interactive elements like task checkboxes get properly bound to the source
	 *    file because we pass the correct `sourcePath`.
	 * 4. Wikilinks, embeds, and all other Obsidian-native Markdown features work
	 *    because the rendering goes through the same pipeline as normal note content.
	 */
	private renderTabContent(index: number, container: HTMLElement): void {
		const tab = this.tabs[index];
		if (!tab) return;

		const contentEl = container.createDiv({
			cls: "tabbed-container-tab-content",
		});
		contentEl.setAttribute("role", "tabpanel");

		// Use Obsidian's MarkdownRenderer to render full Markdown with all native
		// features: wikilinks, embeds, task checkboxes, Dataview, etc.
		MarkdownRenderer.render(
			this.plugin.app,
			tab.content,
			contentEl,
			this.sourcePath,
			this,
		);
	}
}

export default class TabbedContainersPlugin extends Plugin {
	settings: TabbedContainersSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the ```tabs code block processor
		this.registerMarkdownCodeBlockProcessor(
			"tabs",
			(source: string, el: HTMLElement, ctx) => {
				const tabs = parseTabs(source);
				const component = new TabbedContainerComponent(
					el,
					tabs,
					ctx.sourcePath,
					this,
				);
				ctx.addChild(component);
			},
		);

		// Command to insert a tab template at the cursor
		this.addCommand({
			id: "insert-tabs-template",
			name: "Insert tabs template",
			editorCallback: (editor) => {
				const template = [
					"```tabs",
					"--- Tab 1",
					"Content for tab 1",
					"",
					"--- Tab 2",
					"Content for tab 2",
					"```",
				].join("\n");
				editor.replaceSelection(template);
			},
		});

		this.addSettingTab(new TabbedContainersSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TabbedContainersSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	Plugin,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	TabbedContainersSettings,
	TabbedContainersSettingTab,
} from "./settings";

/* ================================================================
   Tab Parsing
   ================================================================ */

interface ParsedTab {
	title: string;
	icon: string;
	content: string;
}

/**
 * Parses tab title into icon (emoji) and text portions.
 * Supports:  --- 📋 My Tab   →  icon="📋", title="My Tab"
 *            --- My Tab       →  icon="",   title="My Tab"
 */
function parseTabTitle(raw: string): { icon: string; title: string } {
	const emojiMatch = raw.match(
		/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s+(.*)/u,
	);
	if (emojiMatch) {
		return { icon: emojiMatch[1]!, title: emojiMatch[2]!.trim() };
	}
	return { icon: "", title: raw.trim() };
}

/**
 * Parses the raw content of a ```tabs code block into individual tabs.
 *
 * Syntax:
 *   ```tabs
 *   --- Tab Title 1
 *   Content for tab 1
 *
 *   --- 📋 Tab Title 2
 *   Content for tab 2
 *   ```
 */
function parseTabs(source: string): ParsedTab[] {
	const tabs: ParsedTab[] = [];
	const lines = source.split("\n");

	let currentRawTitle: string | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		const match = line.match(/^---\s+(.+)$/);
		if (match) {
			if (currentRawTitle !== null) {
				const { icon, title } = parseTabTitle(currentRawTitle);
				tabs.push({
					icon,
					title,
					content: currentLines.join("\n").trim(),
				});
			}
			currentRawTitle = match[1]!.trim();
			currentLines = [];
		} else {
			currentLines.push(line);
		}
	}

	if (currentRawTitle !== null) {
		const { icon, title } = parseTabTitle(currentRawTitle);
		tabs.push({
			icon,
			title,
			content: currentLines.join("\n").trim(),
		});
	}

	return tabs;
}

/**
 * Reconstructs the code block source from parsed tabs.
 */
function serializeTabs(tabs: ParsedTab[]): string {
	return tabs
		.map((tab) => {
			const titleLine = tab.icon
				? `--- ${tab.icon} ${tab.title}`
				: `--- ${tab.title}`;
			return tab.content ? `${titleLine}\n${tab.content}` : titleLine;
		})
		.join("\n\n");
}

/* ================================================================
   Source Editing — reads/writes the code block back to the vault
   ================================================================ */

/**
 * Replaces the content of a ```tabs code block in the source file.
 * Uses getSectionInfo() to find the exact line range.
 */
async function updateSourceBlock(
	plugin: TabbedContainersPlugin,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	newSource: string,
): Promise<void> {
	const file = plugin.app.vault.getFileByPath(ctx.sourcePath);
	if (!file) return;

	const sectionInfo = ctx.getSectionInfo(el);
	if (!sectionInfo) return;

	const fileContent = await plugin.app.vault.read(file);
	const lines = fileContent.split("\n");

	// sectionInfo.lineStart = the ```tabs line
	// sectionInfo.lineEnd   = the closing ``` line
	// We replace everything between them (exclusive of the fences).
	const before = lines.slice(0, sectionInfo.lineStart + 1);
	const after = lines.slice(sectionInfo.lineEnd);

	const updated = [...before, newSource, ...after].join("\n");
	await plugin.app.vault.modify(file, updated);
}

/* ================================================================
   Tabbed Container Component
   ================================================================ */

class TabbedContainerComponent extends MarkdownRenderChild {
	private tabs: ParsedTab[];
	private sourcePath: string;
	private plugin: TabbedContainersPlugin;
	private ctx: MarkdownPostProcessorContext;
	private activeIndex = 0;

	constructor(
		containerEl: HTMLElement,
		tabs: ParsedTab[],
		sourcePath: string,
		plugin: TabbedContainersPlugin,
		ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
		this.tabs = tabs;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
		this.ctx = ctx;
	}

	override onload(): void {
		this.render();
	}

	/* ---- Main render ---- */

	private render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("tabbed-container");

		if (this.tabs.length === 0) {
			this.renderEmptyState(el);
			return;
		}

		const tabBar = el.createDiv({ cls: "tabbed-container-tab-bar" });
		tabBar.setAttribute("role", "tablist");
		const tabContentArea = el.createDiv({ cls: "tabbed-container-content" });

		const indicator = tabBar.createDiv({ cls: "tabbed-container-indicator" });
		const tabButtons: HTMLElement[] = [];

		this.tabs.forEach((tab, index) => {
			const btn = this.createTabButton(tab, index, tabButtons, tabContentArea, indicator);
			tabButtons.push(btn);
			tabBar.appendChild(btn);
		});

		// "+" add-tab button
		const addBtn = tabBar.createEl("button", {
			cls: "tabbed-container-add-btn",
			attr: { "aria-label": "Add new tab", title: "Add tab" },
		});
		addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
		addBtn.addEventListener("click", () => this.addTab());

		// Setup drag-and-drop reordering on the tab bar
		this.setupTabReordering(tabBar, tabButtons, tabContentArea, indicator);

		// Render initial active tab
		if (this.activeIndex >= this.tabs.length) {
			this.activeIndex = Math.max(0, this.tabs.length - 1);
		}
		this.renderTabContent(this.activeIndex, tabContentArea);
		this.updateActiveStates(tabButtons);

		requestAnimationFrame(() => {
			this.positionIndicator(indicator, tabButtons);
		});

		// Setup drop zone on content area for dropping external content
		this.setupContentDropZone(tabContentArea);
	}

	/* ---- Empty state ---- */

	private renderEmptyState(el: HTMLElement): void {
		const empty = el.createDiv({ cls: "tabbed-container-empty-state" });
		empty.createEl("p", {
			text: "No tabs yet.",
			cls: "tabbed-container-empty-text",
		});
		const addBtn = empty.createEl("button", {
			text: "Add first tab",
			cls: "tabbed-container-empty-add-btn",
		});
		addBtn.addEventListener("click", () => this.addTab());
	}

	/* ---- Create a single tab button ---- */

	private createTabButton(
		tab: ParsedTab,
		index: number,
		tabButtons: HTMLElement[],
		contentArea: HTMLElement,
		indicator: HTMLElement,
	): HTMLElement {
		const btn = createEl("button", {
			cls: "tabbed-container-tab-button",
			attr: {
				role: "tab",
				"aria-selected": String(index === this.activeIndex),
				tabindex: index === this.activeIndex ? "0" : "-1",
				draggable: "true",
			},
		});

		// Icon
		if (tab.icon) {
			btn.createSpan({ text: tab.icon, cls: "tabbed-container-tab-icon" });
		}

		// Title label
		const label = btn.createSpan({
			text: tab.title,
			cls: "tabbed-container-tab-label",
		});

		// Delete button
		const delBtn = btn.createSpan({
			cls: "tabbed-container-tab-delete",
			attr: { "aria-label": "Delete tab", title: "Delete tab" },
		});
		delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
		delBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.deleteTab(index);
		});

		// Click to switch
		btn.addEventListener("click", () => {
			this.switchTab(index, tabButtons, contentArea, indicator);
		});

		// Double-click to rename
		btn.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.startRename(label, index);
		});

		// Keyboard navigation
		btn.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "F2") {
				e.preventDefault();
				this.startRename(label, index);
				return;
			}

			let targetIndex = -1;
			if (e.key === "ArrowRight") {
				targetIndex = (index + 1) % this.tabs.length;
			} else if (e.key === "ArrowLeft") {
				targetIndex = (index - 1 + this.tabs.length) % this.tabs.length;
			} else if (e.key === "Home") {
				targetIndex = 0;
			} else if (e.key === "End") {
				targetIndex = this.tabs.length - 1;
			} else if (e.key === "Delete") {
				e.preventDefault();
				this.deleteTab(index);
				return;
			}

			if (targetIndex >= 0) {
				e.preventDefault();
				tabButtons[targetIndex]?.focus();
				this.switchTab(targetIndex, tabButtons, contentArea, indicator);
			}
		});

		return btn;
	}

	/* ---- Tab switching ---- */

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

	private positionIndicator(
		indicator: HTMLElement,
		tabButtons: HTMLElement[],
	): void {
		const activeBtn = tabButtons[this.activeIndex];
		if (!activeBtn) return;
		indicator.style.left = `${activeBtn.offsetLeft}px`;
		indicator.style.width = `${activeBtn.offsetWidth}px`;
	}

	/* ---- Render tab Markdown content ---- */

	private renderTabContent(index: number, container: HTMLElement): void {
		const tab = this.tabs[index];
		if (!tab) return;

		const contentEl = container.createDiv({
			cls: "tabbed-container-tab-content",
		});
		contentEl.setAttribute("role", "tabpanel");

		if (!tab.content) {
			const placeholder = contentEl.createDiv({
				cls: "tabbed-container-content-placeholder",
			});
			placeholder.setText("Drop content here or edit the code block to add content.");
			return;
		}

		MarkdownRenderer.render(
			this.plugin.app,
			tab.content,
			contentEl,
			this.sourcePath,
			this,
		);
	}

	/* ---- Inline rename ---- */

	private startRename(labelEl: HTMLElement, index: number): void {
		const tab = this.tabs[index];
		if (!tab) return;

		const input = createEl("input", {
			cls: "tabbed-container-rename-input",
			attr: { type: "text", value: tab.title },
		});

		labelEl.replaceWith(input);
		input.focus();
		input.select();

		const commit = () => {
			const newTitle = input.value.trim() || tab.title;
			tab.title = newTitle;
			const newLabel = createSpan({
				text: newTitle,
				cls: "tabbed-container-tab-label",
			});
			input.replaceWith(newLabel);

			// Re-bind double-click on the new label
			const btn = newLabel.closest(".tabbed-container-tab-button");
			if (btn) {
				newLabel.addEventListener("dblclick", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.startRename(newLabel, index);
				});
			}

			this.persistTabs();
		};

		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				input.blur();
			} else if (e.key === "Escape") {
				input.value = tab.title;
				input.blur();
			}
		});
		// Prevent click from bubbling to the tab button
		input.addEventListener("click", (e) => e.stopPropagation());
	}

	/* ---- Add / Delete tabs ---- */

	private addTab(): void {
		this.tabs.push({
			icon: "",
			title: `Tab ${this.tabs.length + 1}`,
			content: "",
		});
		this.activeIndex = this.tabs.length - 1;
		this.persistTabs();
	}

	private deleteTab(index: number): void {
		if (this.tabs.length <= 1) return; // Keep at least one tab
		this.tabs.splice(index, 1);
		if (this.activeIndex >= this.tabs.length) {
			this.activeIndex = this.tabs.length - 1;
		} else if (this.activeIndex > index) {
			this.activeIndex--;
		}
		this.persistTabs();
	}

	/* ---- Drag-and-drop: tab reordering ---- */

	private setupTabReordering(
		tabBar: HTMLElement,
		_tabButtons: HTMLElement[],
		_contentArea: HTMLElement,
		_indicator: HTMLElement,
	): void {
		let dragIndex = -1;

		tabBar.addEventListener("dragstart", (e: DragEvent) => {
			const btn = (e.target as HTMLElement).closest(
				".tabbed-container-tab-button",
			) as HTMLElement | null;
			if (!btn) return;

			dragIndex = this.getTabButtonIndex(tabBar, btn);
			if (dragIndex < 0) return;

			btn.addClass("is-dragging");
			e.dataTransfer?.setData("text/plain", String(dragIndex));
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		});

		tabBar.addEventListener("dragover", (e: DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

			const btn = (e.target as HTMLElement).closest(
				".tabbed-container-tab-button",
			) as HTMLElement | null;
			if (!btn) return;

			// Visual drop indicator
			tabBar
				.querySelectorAll(".tabbed-container-tab-button")
				.forEach((b) => b.removeClass("drag-over-left", "drag-over-right"));

			const rect = btn.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			if (e.clientX < midX) {
				btn.addClass("drag-over-left");
			} else {
				btn.addClass("drag-over-right");
			}
		});

		tabBar.addEventListener("dragleave", (e: DragEvent) => {
			const btn = (e.target as HTMLElement).closest(
				".tabbed-container-tab-button",
			) as HTMLElement | null;
			if (btn) btn.removeClass("drag-over-left", "drag-over-right");
		});

		tabBar.addEventListener("drop", (e: DragEvent) => {
			e.preventDefault();
			tabBar
				.querySelectorAll(".tabbed-container-tab-button")
				.forEach((b) => b.removeClass("drag-over-left", "drag-over-right", "is-dragging"));

			const btn = (e.target as HTMLElement).closest(
				".tabbed-container-tab-button",
			) as HTMLElement | null;
			if (!btn || dragIndex < 0) return;

			let dropIndex = this.getTabButtonIndex(tabBar, btn);
			if (dropIndex < 0 || dropIndex === dragIndex) return;

			const rect = btn.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			if (e.clientX >= midX && dropIndex < dragIndex) {
				dropIndex++;
			} else if (e.clientX < midX && dropIndex > dragIndex) {
				dropIndex--;
			}

			// Reorder the tabs array
			const [movedTab] = this.tabs.splice(dragIndex, 1);
			if (!movedTab) return;
			this.tabs.splice(dropIndex, 0, movedTab);

			// Adjust active index
			if (this.activeIndex === dragIndex) {
				this.activeIndex = dropIndex;
			} else if (
				dragIndex < this.activeIndex &&
				dropIndex >= this.activeIndex
			) {
				this.activeIndex--;
			} else if (
				dragIndex > this.activeIndex &&
				dropIndex <= this.activeIndex
			) {
				this.activeIndex++;
			}

			this.persistTabs();
		});

		tabBar.addEventListener("dragend", () => {
			tabBar
				.querySelectorAll(".tabbed-container-tab-button")
				.forEach((b) => b.removeClass("drag-over-left", "drag-over-right", "is-dragging"));
			dragIndex = -1;
		});
	}

	private getTabButtonIndex(tabBar: HTMLElement, btn: HTMLElement): number {
		const buttons = tabBar.querySelectorAll(".tabbed-container-tab-button");
		let idx = -1;
		buttons.forEach((b, i) => {
			if (b === btn) idx = i;
		});
		return idx;
	}

	/* ---- Drag-and-drop: content into tab panels ---- */

	private setupContentDropZone(contentArea: HTMLElement): void {
		contentArea.addEventListener("dragover", (e: DragEvent) => {
			// Only accept external content (not tab reordering)
			if (
				e.dataTransfer?.types.includes("text/plain") &&
				!e.dataTransfer.types.includes("Files")
			) {
				// Check if this is a tab reorder drag (has numeric data)
				// We accept only non-numeric drops (text content)
			}
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
			contentArea.addClass("drop-active");
		});

		contentArea.addEventListener("dragleave", () => {
			contentArea.removeClass("drop-active");
		});

		contentArea.addEventListener("drop", (e: DragEvent) => {
			e.preventDefault();
			contentArea.removeClass("drop-active");

			const tab = this.tabs[this.activeIndex];
			if (!tab) return;

			// Get dropped text content
			const text = e.dataTransfer?.getData("text/plain");
			if (!text || /^\d+$/.test(text)) return; // Ignore tab reorder numeric data

			// Append to current tab's content
			tab.content = tab.content
				? `${tab.content}\n\n${text}`
				: text;

			this.persistTabs();
		});
	}

	/* ---- Persist: write tabs back to source ---- */

	private persistTabs(): void {
		const newSource = serializeTabs(this.tabs);
		updateSourceBlock(this.plugin, this.ctx, this.containerEl, newSource);
		// Obsidian will re-render the block automatically after vault.modify()
	}
}

/* ================================================================
   Plugin
   ================================================================ */

export default class TabbedContainersPlugin extends Plugin {
	settings: TabbedContainersSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor(
			"tabs",
			(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				const tabs = parseTabs(source);
				const component = new TabbedContainerComponent(
					el,
					tabs,
					ctx.sourcePath,
					this,
					ctx,
				);
				ctx.addChild(component);
			},
		);

		// Insert command — defaults to 3 tabs
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
					"",
					"--- Tab 3",
					"Content for tab 3",
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

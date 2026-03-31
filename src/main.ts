import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
	setIcon,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	TabbedContainersSettings,
	TabbedContainersSettingTab,
} from "./settings";

/* ================================================================
   Constants
   ================================================================ */

const TAB_REORDER_MIME = "application/x-tabbed-container-reorder";

/* ================================================================
   Tab Parsing
   ================================================================ */

interface ParsedTab {
	title: string;
	icon: string;
	content: string;
}

function parseTabTitle(raw: string): { icon: string; title: string } {
	const emojiMatch = raw.match(
		/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s+(.*)/u,
	);
	if (emojiMatch) {
		return { icon: emojiMatch[1]!, title: emojiMatch[2]!.trim() };
	}
	return { icon: "", title: raw.trim() };
}

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
   Source Editing — robust code block replacement
   ================================================================ */

/**
 * Replaces the content of a ```tabs code block in the source file.
 *
 * Strategy (two-pass for reliability):
 * 1. Try getSectionInfo() first — fastest and most precise.
 * 2. Fallback: search the file for the ```tabs block whose content
 *    matches `originalSource` and replace it. This works even when
 *    getSectionInfo() returns null (common in Live Preview).
 *
 * Returns true if the update succeeded, false otherwise.
 */
async function updateSourceBlock(
	plugin: TabbedContainersPlugin,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	originalSource: string,
	newSource: string,
): Promise<boolean> {
	const file = plugin.app.vault.getFileByPath(ctx.sourcePath);
	if (!file) return false;

	const fileContent = await plugin.app.vault.read(file);

	// --- Strategy 1: getSectionInfo ---
	const sectionInfo = ctx.getSectionInfo(el);
	if (sectionInfo) {
		const lines = fileContent.split("\n");
		const before = lines.slice(0, sectionInfo.lineStart + 1);
		const after = lines.slice(sectionInfo.lineEnd);
		const updated = [...before, newSource, ...after].join("\n");
		await plugin.app.vault.modify(file, updated);
		return true;
	}

	// --- Strategy 2: text search fallback ---
	// Build the full fenced block pattern using the original source
	const fencedOriginal = "```tabs\n" + originalSource + "\n```";
	const fencedNew = "```tabs\n" + newSource + "\n```";

	const idx = fileContent.indexOf(fencedOriginal);
	if (idx >= 0) {
		const updated =
			fileContent.slice(0, idx) +
			fencedNew +
			fileContent.slice(idx + fencedOriginal.length);
		await plugin.app.vault.modify(file, updated);
		return true;
	}

	// Neither strategy worked
	new Notice("Tabbed containers: could not locate the code block to update.");
	return false;
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
	/** The raw source as it was when this component was created / last persisted. */
	private currentSource: string;
	/** Unique key for this code block, used to persist active tab across re-renders. */
	private blockKey: string;

	constructor(
		containerEl: HTMLElement,
		tabs: ParsedTab[],
		source: string,
		sourcePath: string,
		plugin: TabbedContainersPlugin,
		ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
		this.tabs = tabs;
		this.currentSource = source;
		this.sourcePath = sourcePath;
		this.plugin = plugin;
		this.ctx = ctx;

		// Build a stable key from file path + section position (or source hash)
		const sectionInfo = ctx.getSectionInfo(containerEl);
		this.blockKey = sectionInfo
			? `${sourcePath}:${sectionInfo.lineStart}`
			: `${sourcePath}:${this.hashCode(source)}`;

		// Restore persisted active tab index
		const saved = plugin.activeTabMap.get(this.blockKey);
		if (saved !== undefined && saved < tabs.length) {
			this.activeIndex = saved;
		}
	}

	override onload(): void {
		this.render();
	}

	override onunload(): void {
		// Save active tab so the next render can restore it
		this.plugin.activeTabMap.set(this.blockKey, this.activeIndex);
	}

	private hashCode(s: string): number {
		let hash = 0;
		for (let i = 0; i < s.length; i++) {
			hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
		}
		return hash;
	}

	/* ---- Main render ---- */

	private render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("tabbed-container");

		const style = this.plugin.settings.tabStyle;
		el.toggleClass("tabbed-container--pill", style === "pill");
		el.toggleClass("tabbed-container--underline", style === "underline");

		if (this.tabs.length === 0) {
			this.renderEmptyState(el);
			return;
		}

		// --- Toolbar row (edit source button) ---
		const toolbar = el.createDiv({ cls: "tabbed-container-toolbar" });

		const editBtn = toolbar.createEl("button", {
			cls: "tabbed-container-edit-btn",
			attr: {
				"aria-label": "Edit source",
				title: "Edit source",
			},
		});
		setIcon(editBtn, "code");
		editBtn.addEventListener("click", () => this.jumpToSource());

		// --- Tab bar ---
		const tabBar = el.createDiv({ cls: "tabbed-container-tab-bar" });
		tabBar.setAttribute("role", "tablist");
		const tabContentArea = el.createDiv({ cls: "tabbed-container-content" });

		const indicator = tabBar.createDiv({ cls: "tabbed-container-indicator" });
		const tabButtons: HTMLElement[] = [];

		this.tabs.forEach((tab, index) => {
			const btn = this.createTabButton(
				tab,
				index,
				tabButtons,
				tabContentArea,
				indicator,
			);
			tabButtons.push(btn);
			tabBar.appendChild(btn);
		});

		// "+" add-tab button
		const addBtn = tabBar.createEl("button", {
			cls: "tabbed-container-add-btn",
			attr: { "aria-label": "Add new tab", title: "Add tab" },
		});
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", () => this.addTab());

		this.setupTabReordering(tabBar);

		// Clamp active index
		if (this.activeIndex >= this.tabs.length) {
			this.activeIndex = Math.max(0, this.tabs.length - 1);
		}

		this.renderTabContent(this.activeIndex, tabContentArea);
		this.updateActiveStates(tabButtons);

		requestAnimationFrame(() => {
			this.positionIndicator(indicator, tabButtons);
		});

		this.setupContentDropZone(tabContentArea);
	}

	/* ---- Jump to source ---- */

	private jumpToSource(): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const sectionInfo = this.ctx.getSectionInfo(this.containerEl);
		if (sectionInfo) {
			// Switch to source/edit mode and place cursor at the code block
			const state = view.getState();
			state.mode = "source";
			void view.setState(state, { history: false });
			view.editor.setCursor({ line: sectionInfo.lineStart, ch: 0 });
			view.editor.focus();
			return;
		}

		// Fallback: just switch to source mode
		const state = view.getState();
		state.mode = "source";
		void view.setState(state, { history: false });
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
		const btn = document.createElement("button");
		btn.className = "tabbed-container-tab-button";
		btn.setAttribute("role", "tab");
		btn.setAttribute("aria-selected", String(index === this.activeIndex));
		btn.setAttribute("tabindex", index === this.activeIndex ? "0" : "-1");
		btn.setAttribute("draggable", "true");

		if (tab.icon) {
			btn.createSpan({ text: tab.icon, cls: "tabbed-container-tab-icon" });
		}

		const label = btn.createSpan({
			text: tab.title,
			cls: "tabbed-container-tab-label",
		});

		const delBtn = btn.createSpan({
			cls: "tabbed-container-tab-delete",
			attr: { "aria-label": "Delete tab", title: "Delete tab" },
		});
		setIcon(delBtn, "x");
		delBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.deleteTab(index);
		});

		btn.addEventListener("click", () => {
			this.switchTab(index, tabButtons, contentArea, indicator);
		});

		btn.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.startRename(label, index);
		});

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
		this.plugin.activeTabMap.set(this.blockKey, index);
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
			placeholder.setText(
				"Drop content here or edit the code block to add content.",
			);
			return;
		}

		void MarkdownRenderer.render(
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

		const input = document.createElement("input");
		input.className = "tabbed-container-rename-input";
		input.type = "text";
		input.value = tab.title;

		labelEl.replaceWith(input);
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;

			const newTitle = input.value.trim() || tab.title;
			tab.title = newTitle;
			const newLabel = document.createElement("span");
			newLabel.className = "tabbed-container-tab-label";
			newLabel.textContent = newTitle;
			input.replaceWith(newLabel);
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
		if (this.tabs.length <= 1) return;
		this.tabs.splice(index, 1);
		if (this.activeIndex >= this.tabs.length) {
			this.activeIndex = this.tabs.length - 1;
		} else if (this.activeIndex > index) {
			this.activeIndex--;
		}
		this.persistTabs();
	}

	/* ---- Drag-and-drop: tab reordering ---- */

	private setupTabReordering(tabBar: HTMLElement): void {
		let dragIndex = -1;

		tabBar.addEventListener("dragstart", (e: DragEvent) => {
			const btn = (e.target as HTMLElement).closest<HTMLElement>(
				".tabbed-container-tab-button",
			);
			if (!btn) return;

			dragIndex = this.getTabButtonIndex(tabBar, btn);
			if (dragIndex < 0) return;

			btn.addClass("is-dragging");
			e.dataTransfer?.setData(TAB_REORDER_MIME, String(dragIndex));
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		});

		tabBar.addEventListener("dragover", (e: DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

			const btn = (e.target as HTMLElement).closest<HTMLElement>(
				".tabbed-container-tab-button",
			);
			if (!btn) return;

			tabBar
				.querySelectorAll(".tabbed-container-tab-button")
				.forEach((b) =>
					b.removeClass("drag-over-left", "drag-over-right"),
				);

			const rect = btn.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			btn.addClass(e.clientX < midX ? "drag-over-left" : "drag-over-right");
		});

		tabBar.addEventListener("dragleave", (e: DragEvent) => {
			const btn = (e.target as HTMLElement).closest<HTMLElement>(
				".tabbed-container-tab-button",
			);
			if (btn) btn.removeClass("drag-over-left", "drag-over-right");
		});

		tabBar.addEventListener("drop", (e: DragEvent) => {
			e.preventDefault();
			this.clearDragStyles(tabBar);

			const btn = (e.target as HTMLElement).closest<HTMLElement>(
				".tabbed-container-tab-button",
			);
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

			const [movedTab] = this.tabs.splice(dragIndex, 1);
			if (!movedTab) return;
			this.tabs.splice(dropIndex, 0, movedTab);

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
			this.clearDragStyles(tabBar);
			dragIndex = -1;
		});
	}

	private clearDragStyles(tabBar: HTMLElement): void {
		tabBar
			.querySelectorAll(".tabbed-container-tab-button")
			.forEach((b) =>
				b.removeClass("drag-over-left", "drag-over-right", "is-dragging"),
			);
	}

	private getTabButtonIndex(tabBar: HTMLElement, btn: HTMLElement): number {
		const buttons = tabBar.querySelectorAll(
			".tabbed-container-tab-button",
		);
		let idx = -1;
		buttons.forEach((b, i) => {
			if (b === btn) idx = i;
		});
		return idx;
	}

	/* ---- Drag-and-drop: content into tab panels ---- */

	private setupContentDropZone(contentArea: HTMLElement): void {
		contentArea.addEventListener("dragover", (e: DragEvent) => {
			if (e.dataTransfer?.types.includes(TAB_REORDER_MIME)) return;

			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
			contentArea.addClass("drop-active");
		});

		contentArea.addEventListener("dragleave", (e: DragEvent) => {
			const related = e.relatedTarget as Node | null;
			if (related && contentArea.contains(related)) return;
			contentArea.removeClass("drop-active");
		});

		contentArea.addEventListener("drop", (e: DragEvent) => {
			e.preventDefault();
			contentArea.removeClass("drop-active");

			if (e.dataTransfer?.types.includes(TAB_REORDER_MIME)) return;

			const tab = this.tabs[this.activeIndex];
			if (!tab) return;

			let droppedContent = "";

			const textData = e.dataTransfer?.getData("text/plain") ?? "";

			const files = e.dataTransfer?.files;
			if (files && files.length > 0) {
				const links: string[] = [];
				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					if (file) {
						const name = file.name.replace(/\.[^.]+$/, "");
						links.push(`![[${name}]]`);
					}
				}
				droppedContent = links.join("\n");
			} else if (textData) {
				droppedContent = textData;
			}

			if (!droppedContent) return;

			tab.content = tab.content
				? `${tab.content}\n\n${droppedContent}`
				: droppedContent;

			this.persistTabs();
		});
	}

	/* ---- Persist: write tabs back to source ---- */

	private persistTabs(): void {
		const newSource = serializeTabs(this.tabs);
		// Save active tab before the re-render destroys this component
		this.plugin.activeTabMap.set(this.blockKey, this.activeIndex);
		void updateSourceBlock(
			this.plugin,
			this.ctx,
			this.containerEl,
			this.currentSource,
			newSource,
		);
		// Update currentSource so subsequent edits can find the block
		this.currentSource = newSource;
	}
}

/* ================================================================
   Plugin
   ================================================================ */

export default class TabbedContainersPlugin extends Plugin {
	settings: TabbedContainersSettings = DEFAULT_SETTINGS;
	/** Tracks which tab is active for each code block, surviving re-renders. */
	activeTabMap: Map<string, number> = new Map();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor(
			"tabs",
			(
				source: string,
				el: HTMLElement,
				ctx: MarkdownPostProcessorContext,
			) => {
				const tabs = parseTabs(source);
				const component = new TabbedContainerComponent(
					el,
					tabs,
					source,
					ctx.sourcePath,
					this,
					ctx,
				);
				ctx.addChild(component);
			},
		);

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

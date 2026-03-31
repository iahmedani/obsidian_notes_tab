import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
	setIcon,
} from "obsidian";
// eslint-disable-next-line import/no-extraneous-dependencies -- bundled by Obsidian
import { EditorView } from "@codemirror/view";
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
				tabs.push({ icon, title, content: currentLines.join("\n").trim() });
			}
			currentRawTitle = match[1]!.trim();
			currentLines = [];
		} else {
			currentLines.push(line);
		}
	}

	if (currentRawTitle !== null) {
		const { icon, title } = parseTabTitle(currentRawTitle);
		tabs.push({ icon, title, content: currentLines.join("\n").trim() });
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
   Source Editing
   ================================================================ */

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

	// Strategy 1: getSectionInfo
	const sectionInfo = ctx.getSectionInfo(el);
	if (sectionInfo) {
		const lines = fileContent.split("\n");
		const before = lines.slice(0, sectionInfo.lineStart + 1);
		const after = lines.slice(sectionInfo.lineEnd);
		const updated = [...before, newSource, ...after].join("\n");
		await plugin.app.vault.modify(file, updated);
		return true;
	}

	// Strategy 2: text search fallback
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
	private currentSource: string;
	private blockKey: string;
	/** Whether a tab content area is currently in inline-edit mode */
	private editingTabIndex = -1;

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

		const sectionInfo = ctx.getSectionInfo(containerEl);
		this.blockKey = sectionInfo
			? `${sourcePath}:${sectionInfo.lineStart}`
			: `${sourcePath}:${this.hashCode(source)}`;

		const saved = plugin.activeTabMap.get(this.blockKey);
		if (saved !== undefined && saved < tabs.length) {
			this.activeIndex = saved;
		}
	}

	override onload(): void {
		this.render();
	}

	override onunload(): void {
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

		// --- Tab bar ---
		const tabBar = el.createDiv({ cls: "tabbed-container-tab-bar" });
		tabBar.setAttribute("role", "tablist");
		const tabContentArea = el.createDiv({ cls: "tabbed-container-content" });

		const indicator = tabBar.createDiv({ cls: "tabbed-container-indicator" });
		const tabButtons: HTMLElement[] = [];

		this.tabs.forEach((tab, index) => {
			const btn = this.createTabButton(
				tab, index, tabButtons, tabContentArea, indicator,
			);
			tabButtons.push(btn);
			tabBar.appendChild(btn);
		});

		// "+" add button
		const addBtn = tabBar.createEl("button", {
			cls: "tabbed-container-add-btn",
			attr: { "aria-label": "Add new tab", title: "Add tab" },
		});
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", () => this.addTab());

		this.setupTabReordering(tabBar);

		if (this.activeIndex >= this.tabs.length) {
			this.activeIndex = Math.max(0, this.tabs.length - 1);
		}

		this.renderTabContent(this.activeIndex, tabContentArea, tabButtons, indicator);
		this.updateActiveStates(tabButtons);

		requestAnimationFrame(() => {
			this.positionIndicator(indicator, tabButtons);
		});

		this.setupContentDropZone(tabContentArea);
	}

	/* ---- Empty state ---- */

	private renderEmptyState(el: HTMLElement): void {
		const empty = el.createDiv({ cls: "tabbed-container-empty-state" });
		empty.createEl("p", { text: "No tabs yet.", cls: "tabbed-container-empty-text" });
		const addBtn = empty.createEl("button", {
			text: "Add first tab",
			cls: "tabbed-container-empty-add-btn",
		});
		addBtn.addEventListener("click", () => this.addTab());
	}

	/* ---- Create tab button ---- */

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

		const label = btn.createSpan({ text: tab.title, cls: "tabbed-container-tab-label" });

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
			if (e.key === "ArrowRight") targetIndex = (index + 1) % this.tabs.length;
			else if (e.key === "ArrowLeft") targetIndex = (index - 1 + this.tabs.length) % this.tabs.length;
			else if (e.key === "Home") targetIndex = 0;
			else if (e.key === "End") targetIndex = this.tabs.length - 1;
			else if (e.key === "Delete") { e.preventDefault(); this.deleteTab(index); return; }
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
		this.editingTabIndex = -1; // exit edit mode on tab switch
		this.activeIndex = index;
		this.plugin.activeTabMap.set(this.blockKey, index);
		this.updateActiveStates(tabButtons);
		this.positionIndicator(indicator, tabButtons);
		contentArea.empty();
		this.renderTabContent(index, contentArea, tabButtons, indicator);
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

	/* ---- Render tab content ---- */

	private renderTabContent(
		index: number,
		container: HTMLElement,
		tabButtons: HTMLElement[],
		indicator: HTMLElement,
	): void {
		const tab = this.tabs[index];
		if (!tab) return;

		const contentWrapper = container.createDiv({ cls: "tabbed-container-tab-content" });
		contentWrapper.setAttribute("role", "tabpanel");

		// --- Content toolbar (edit / source buttons) ---
		const contentToolbar = contentWrapper.createDiv({ cls: "tabbed-container-content-toolbar" });

		const editContentBtn = contentToolbar.createEl("button", {
			cls: "tabbed-container-content-action-btn",
			attr: { "aria-label": "Edit tab content", title: "Edit content" },
		});
		setIcon(editContentBtn, "pencil");
		editContentBtn.addEventListener("click", () => {
			this.toggleContentEdit(index, contentWrapper, tabButtons, indicator);
		});

		const viewSourceBtn = contentToolbar.createEl("button", {
			cls: "tabbed-container-content-action-btn",
			attr: { "aria-label": "View source", title: "View source" },
		});
		setIcon(viewSourceBtn, "code");
		viewSourceBtn.addEventListener("click", () => this.jumpToSource());

		// --- Rendered content ---
		const contentEl = contentWrapper.createDiv({ cls: "tabbed-container-rendered" });

		if (!tab.content) {
			const placeholder = contentEl.createDiv({ cls: "tabbed-container-content-placeholder" });
			placeholder.setText("Click the pencil icon to add content, or drop content here.");
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

	/* ---- Inline content editing ---- */

	private toggleContentEdit(
		index: number,
		contentWrapper: HTMLElement,
		tabButtons: HTMLElement[],
		indicator: HTMLElement,
	): void {
		const tab = this.tabs[index];
		if (!tab) return;

		if (this.editingTabIndex === index) {
			// Already editing — exit handled by save button / blur
			return;
		}

		this.editingTabIndex = index;

		// Remove rendered content, keep toolbar
		const rendered = contentWrapper.querySelector(".tabbed-container-rendered");
		const editor = contentWrapper.querySelector(".tabbed-container-editor");
		if (editor) editor.remove();
		if (rendered) rendered.remove();

		// Create editor area
		const editorArea = contentWrapper.createDiv({ cls: "tabbed-container-editor" });

		const textarea = editorArea.createEl("textarea", {
			cls: "tabbed-container-textarea",
			attr: { placeholder: "Enter content here..." },
		});
		textarea.value = tab.content;

		// Auto-resize textarea via CSS class toggle
		const autoResize = () => {
			textarea.setCssProps({ "--textarea-height": textarea.scrollHeight + "px" });
		};
		textarea.addEventListener("input", autoResize);
		requestAnimationFrame(autoResize);

		// Save button
		const saveBar = editorArea.createDiv({ cls: "tabbed-container-save-bar" });
		const saveBtn = saveBar.createEl("button", {
			text: "Save",
			cls: "tabbed-container-save-btn",
		});
		const cancelBtn = saveBar.createEl("button", {
			text: "Cancel",
			cls: "tabbed-container-cancel-btn",
		});

		const save = () => {
			tab.content = textarea.value.trim();
			this.editingTabIndex = -1;
			this.persistTabs();
			// Re-render this tab's content (persistTabs triggers full re-render via vault.modify)
		};

		const cancel = () => {
			this.editingTabIndex = -1;
			// Re-render without saving
			const container = contentWrapper.parentElement;
			if (container) {
				container.empty();
				this.renderTabContent(index, container, tabButtons, indicator);
			}
		};

		saveBtn.addEventListener("click", save);
		cancelBtn.addEventListener("click", cancel);

		// Keyboard shortcuts in textarea
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				cancel();
			}
			// Cmd/Ctrl + Enter to save
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				save();
			}
			// Prevent event from bubbling to CM6 editor
			e.stopPropagation();
		});

		// Focus the textarea
		textarea.focus();
	}

	/* ---- Jump to source ---- */

	private jumpToSource(): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const sectionInfo = this.ctx.getSectionInfo(this.containerEl);
		if (sectionInfo) {
			const state = view.getState();
			state.mode = "source";
			void view.setState(state, { history: false });
			view.editor.setCursor({ line: sectionInfo.lineStart, ch: 0 });
			view.editor.focus();
			return;
		}
		const state = view.getState();
		state.mode = "source";
		void view.setState(state, { history: false });
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
			if (e.key === "Enter") { e.preventDefault(); input.blur(); }
			else if (e.key === "Escape") { input.value = tab.title; input.blur(); }
			e.stopPropagation();
		});
		input.addEventListener("click", (e) => e.stopPropagation());
	}

	/* ---- Add / Delete ---- */

	private addTab(): void {
		this.tabs.push({ icon: "", title: `Tab ${this.tabs.length + 1}`, content: "" });
		this.activeIndex = this.tabs.length - 1;
		this.persistTabs();
	}

	private deleteTab(index: number): void {
		if (this.tabs.length <= 1) return;
		this.tabs.splice(index, 1);
		if (this.activeIndex >= this.tabs.length) this.activeIndex = this.tabs.length - 1;
		else if (this.activeIndex > index) this.activeIndex--;
		this.persistTabs();
	}

	/* ---- Drag-and-drop: tab reordering ---- */

	private setupTabReordering(tabBar: HTMLElement): void {
		let dragIndex = -1;

		tabBar.addEventListener("dragstart", (e: DragEvent) => {
			const btn = (e.target as HTMLElement).closest<HTMLElement>(".tabbed-container-tab-button");
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
			const btn = (e.target as HTMLElement).closest<HTMLElement>(".tabbed-container-tab-button");
			if (!btn) return;
			tabBar.querySelectorAll(".tabbed-container-tab-button")
				.forEach((b) => b.removeClass("drag-over-left", "drag-over-right"));
			const rect = btn.getBoundingClientRect();
			btn.addClass(e.clientX < rect.left + rect.width / 2 ? "drag-over-left" : "drag-over-right");
		});

		tabBar.addEventListener("dragleave", (e: DragEvent) => {
			const btn = (e.target as HTMLElement).closest<HTMLElement>(".tabbed-container-tab-button");
			if (btn) btn.removeClass("drag-over-left", "drag-over-right");
		});

		tabBar.addEventListener("drop", (e: DragEvent) => {
			e.preventDefault();
			this.clearDragStyles(tabBar);
			const btn = (e.target as HTMLElement).closest<HTMLElement>(".tabbed-container-tab-button");
			if (!btn || dragIndex < 0) return;
			let dropIndex = this.getTabButtonIndex(tabBar, btn);
			if (dropIndex < 0 || dropIndex === dragIndex) return;
			const rect = btn.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			if (e.clientX >= midX && dropIndex < dragIndex) dropIndex++;
			else if (e.clientX < midX && dropIndex > dragIndex) dropIndex--;
			const [movedTab] = this.tabs.splice(dragIndex, 1);
			if (!movedTab) return;
			this.tabs.splice(dropIndex, 0, movedTab);
			if (this.activeIndex === dragIndex) this.activeIndex = dropIndex;
			else if (dragIndex < this.activeIndex && dropIndex >= this.activeIndex) this.activeIndex--;
			else if (dragIndex > this.activeIndex && dropIndex <= this.activeIndex) this.activeIndex++;
			this.persistTabs();
		});

		tabBar.addEventListener("dragend", () => { this.clearDragStyles(tabBar); dragIndex = -1; });
	}

	private clearDragStyles(tabBar: HTMLElement): void {
		tabBar.querySelectorAll(".tabbed-container-tab-button")
			.forEach((b) => b.removeClass("drag-over-left", "drag-over-right", "is-dragging"));
	}

	private getTabButtonIndex(tabBar: HTMLElement, btn: HTMLElement): number {
		const buttons = tabBar.querySelectorAll(".tabbed-container-tab-button");
		let idx = -1;
		buttons.forEach((b, i) => { if (b === btn) idx = i; });
		return idx;
	}

	/* ---- Drag-and-drop: content ---- */

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
					if (file) links.push(`![[${file.name.replace(/\.[^.]+$/, "")}]]`);
				}
				droppedContent = links.join("\n");
			} else if (textData) {
				droppedContent = textData;
			}
			if (!droppedContent) return;
			tab.content = tab.content ? `${tab.content}\n\n${droppedContent}` : droppedContent;
			this.persistTabs();
		});
	}

	/* ---- Persist ---- */

	private persistTabs(): void {
		const newSource = serializeTabs(this.tabs);
		this.plugin.activeTabMap.set(this.blockKey, this.activeIndex);
		void updateSourceBlock(this.plugin, this.ctx, this.containerEl, this.currentSource, newSource);
		this.currentSource = newSource;
	}
}

/* ================================================================
   Plugin
   ================================================================ */

export default class TabbedContainersPlugin extends Plugin {
	settings: TabbedContainersSettings = DEFAULT_SETTINGS;
	activeTabMap: Map<string, number> = new Map();

	async onload(): Promise<void> {
		await this.loadSettings();

		// --- CM6 extension: prevent Live Preview from collapsing the rendered
		//     widget back to raw source when the user clicks on the tabs. ---
		this.registerEditorExtension(
			EditorView.domEventHandlers({
				mousedown: (e: MouseEvent) => {
					if ((e.target as HTMLElement).closest(".tabbed-container")) {
						// Returning true tells CM6 "this event is handled" —
						// the editor won't place a cursor or reveal the source.
						return true;
					}
					return false;
				},
			}),
		);

		// --- Code block processor (renders tabs in both Reading View & Live Preview) ---
		this.registerMarkdownCodeBlockProcessor(
			"tabs",
			(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				const tabs = parseTabs(source);
				const component = new TabbedContainerComponent(
					el, tabs, source, ctx.sourcePath, this, ctx,
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
			{}, DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TabbedContainersSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

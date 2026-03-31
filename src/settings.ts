import { App, PluginSettingTab, Setting } from "obsidian";
import TabbedContainersPlugin from "./main";

export interface TabbedContainersSettings {
	defaultTabIndex: number;
	tabStyle: "underline" | "pill";
}

export const DEFAULT_SETTINGS: TabbedContainersSettings = {
	defaultTabIndex: 0,
	tabStyle: "underline",
};

export class TabbedContainersSettingTab extends PluginSettingTab {
	plugin: TabbedContainersPlugin;

	constructor(app: App, plugin: TabbedContainersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Tabbed Containers" });

		new Setting(containerEl)
			.setName("Tab style")
			.setDesc("Choose the visual style for the tab bar.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("underline", "Underline (default)")
					.addOption("pill", "Pill / Filled")
					.setValue(this.plugin.settings.tabStyle)
					.onChange(async (value) => {
						this.plugin.settings.tabStyle = value as TabbedContainersSettings["tabStyle"];
						await this.plugin.saveSettings();
					}),
			);
	}
}

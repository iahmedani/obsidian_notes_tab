import { App, PluginSettingTab, Setting } from "obsidian";
import TabbedContainersPlugin from "./main";

export type TabStyle = "underline" | "pill";

export interface TabbedContainersSettings {
	tabStyle: TabStyle;
}

export const DEFAULT_SETTINGS: TabbedContainersSettings = {
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

		new Setting(containerEl)
			.setName("Appearance")
			.setHeading();

		new Setting(containerEl)
			.setName("Tab style")
			.setDesc("Choose the visual style for the tab bar.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("underline", "Underline (default)")
					.addOption("pill", "Pill / filled")
					.setValue(this.plugin.settings.tabStyle)
					.onChange(async (value) => {
						this.plugin.settings.tabStyle = value as TabStyle;
						await this.plugin.saveSettings();
					}),
			);
	}
}

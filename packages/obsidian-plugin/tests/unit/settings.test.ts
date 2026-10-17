import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireApiVersion, type App, type Setting } from 'obsidian';
import LinePlugin from '../../src/main';
import { LineSettingTab } from '../../src/settings';

describe('Settings compatibility and persistence', () => {
  let plugin: LinePlugin;
  let tab: LineSettingTab;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(requireApiVersion).mockReturnValue(true);
    plugin = new LinePlugin({} as App, {} as never);
    plugin.loadData = vi.fn().mockResolvedValue({});
    await plugin.loadSettings();
    plugin.saveSettings = vi.fn().mockResolvedValue(undefined);
    tab = new LineSettingTab(plugin.app, plugin, vi.fn());
    tab.update = vi.fn();
  });

  function controlFor(name: string, method: 'addToggle' | 'addText' | 'addDropdown' | 'addButton') {
    let onChange: (value: never) => Promise<void>;
    let onClick: () => Promise<void>;
    const component = {
      inputEl: {},
      setValue: vi.fn().mockReturnThis(),
      setPlaceholder: vi.fn().mockReturnThis(),
      addOption: vi.fn().mockReturnThis(),
      setButtonText: vi.fn().mockReturnThis(),
      setDisabled: vi.fn().mockReturnThis(),
      onChange(callback: typeof onChange) { onChange = callback; return this; },
      onClick(callback: typeof onClick) { onClick = callback; return this; },
    };
    tab.getSettingDefinitions().find(row => row.name === name)!.render({
      [method]: (configure: (control: typeof component) => void) => configure(component),
    } as unknown as Setting);
    return {
      change: (value: string | boolean) => onChange(value as never),
      click: () => onClick(),
    };
  }

  it('indexes all editable settings without reading or writing plugin data', () => {
    vi.mocked(plugin.loadData).mockClear();
    const names = tab.getSettingDefinitions().filter(row => row.searchable !== false).map(row => row.name);
    expect(names).toEqual([
      'Note folder path', 'Vault ID', 'LINE user ID', 'Auto sync', 'Sync interval', 'Sync on startup',
      'Organize by date', 'Group messages by date', 'Grouped message template',
      'Grouped message frontmatter template', 'Grouped file name template',
      'Individual message file name template', 'Sync images', 'Image folder path',
      'Image file name template', '現在のプラン', 'サブスクリプション状態を更新', 'Register mapping', 'Reset mapping',
    ]);
    expect(plugin.loadData).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('enables grouping, disables date folders and refreshes conditional rows on modern Obsidian', async () => {
    plugin.settings.organizeByDate = true;
    const template = tab.getSettingDefinitions().find(row => row.name === 'Grouped message template')!;
    expect(template.visible!()).toBe(false);
    await controlFor('Group messages by date', 'addToggle').change(true);
    expect(plugin.settings.groupMessagesByDate).toBe(true);
    expect(plugin.settings.organizeByDate).toBe(false);
    expect(template.visible!()).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(tab.update).toHaveBeenCalledOnce();
  });

  it('renders the shared definitions on old Obsidian without calling the modern update API', async () => {
    vi.mocked(requireApiVersion).mockReturnValue(false);
    const render = vi.fn();
    const hiddenRender = vi.fn();
    const control = controlFor('Auto sync', 'addToggle');
    vi.spyOn(tab, 'getSettingDefinitions').mockReturnValue([
      { name: 'Visible', render },
      { name: 'Hidden', visible: () => false, render: hiddenRender },
    ]);
    await control.change(true);
    expect(plugin.settings.autoSync).toBe(true);
    expect(render).toHaveBeenCalledOnce();
    expect(hiddenRender).not.toHaveBeenCalled();
    expect(tab.update).not.toHaveBeenCalled();
  });

  it('persists text edits and retains the existing fallback for empty templates', async () => {
    await controlFor('Note folder path', 'addText').change('Inbox/LINE');
    expect(plugin.settings.noteFolderPath).toBe('Inbox/LINE');
    await controlFor('Grouped file name template', 'addText').change('');
    expect(plugin.settings.groupedFileNameTemplate).toBe('{date}');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid sync intervals while persisting valid selections', async () => {
    const control = controlFor('Sync interval', 'addDropdown');
    await control.change('9');
    expect(plugin.settings.syncInterval).toBe(2);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    await control.change('4');
    expect(plugin.settings.syncInterval).toBe(4);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
  });

  it('refreshes subscription rows through update after fetching status', async () => {
    plugin.fetchSubscriptionStatus = vi.fn().mockResolvedValue(true);
    await controlFor('サブスクリプション状態を更新', 'addButton').click();
    expect(plugin.fetchSubscriptionStatus).toHaveBeenCalledOnce();
    expect(tab.update).toHaveBeenCalledOnce();
  });
});

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import type St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {getLoginManager} from 'resource:///org/gnome/shell/misc/loginManager.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const TARGET_UUID = 'gnome-suspend-inhibitor-indicator@digitaltopo.github.io';
const CLICK_ATTEMPTS = 3;

interface TargetInternals {
    _menu: PopupMenu.PopupMenuBase | null;
    _monitor: {_pollId: number; refresh(): Promise<void>} | null;
    _badge: (St.Button & {_count: St.Label}) | null;
    _dialog: (St.Widget & {_content: {description: string}; _rows: St.BoxLayout; close(): boolean}) | null;
}

export interface Status {
    state: number | null;
    error: string | null;
    stylesheet: string | null;
    attached: boolean;
    itemLabel: string;
    itemChildren: string[];
    badge: {visible: boolean; text: string; accessibleName: string} | null;
    dialog: {description: string; rows: string[][]} | null;
    polling: boolean;
    suspendCalls: number;
    modalCount: number;
    quickSettingsOpen: boolean;
    powerMenuOpen: boolean;
}

const shellMain = Main as unknown as {modalCount: number; overview: {hide(): void}};

function wait(ms: number): Promise<void> {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function quickSettings() {
    return Main.panel.statusArea.quickSettings;
}

function powerMenu(): PopupMenu.PopupMenuBase {
    return quickSettings()._system!._systemItem.menu;
}

function suspendItem(): PopupMenu.PopupMenuItem {
    return powerMenu().firstMenuItem as PopupMenu.PopupMenuItem;
}

function stylesheetName(): string | null {
    const extension = Main.extensionManager.lookup(TARGET_UUID) as {stylesheet?: Gio.File} | undefined;
    return extension?.stylesheet?.get_basename() ?? null;
}

function target(): TargetInternals {
    return Main.extensionManager.lookup(TARGET_UUID)?.stateObj as unknown as TargetInternals;
}

function centerOf(actor: Clutter.Actor): [number, number] {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x + width / 2, y + height / 2];
}

class TestApi {
    suspendCalls = 0;
    patched = false;

    private _pointer: Clutter.VirtualInputDevice;
    private _keyboard: Clutter.VirtualInputDevice;
    private _touch: Clutter.VirtualInputDevice;

    constructor() {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._touch = seat.create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE);
    }

    status(): Status {
        const extension = Main.extensionManager.lookup(TARGET_UUID);
        const internals = target();
        const item = suspendItem();
        const dialog = internals?._dialog ?? null;
        return {
            state: extension?.state ?? null,
            error: extension?.error ? String(extension.error) : null,
            stylesheet: stylesheetName(),
            attached: Boolean(internals?._menu),
            itemLabel: item.label.text,
            itemChildren: item.get_children().map(child => child.constructor.name),
            badge: internals?._badge
                ? {
                      visible: internals._badge.visible,
                      text: internals._badge._count.text,
                      accessibleName: internals._badge.accessible_name,
                  }
                : null,
            dialog: dialog
                ? {
                      description: dialog._content.description,
                      rows: dialog._rows
                          .get_children()
                          .map(row =>
                              row.get_n_children() > 0
                                  ? row.get_children().map(label => (label as St.Label).text)
                                  : [(row as St.Label).text]
                          ),
                  }
                : null,
            polling: Boolean(internals?._monitor?._pollId),
            suspendCalls: this.suspendCalls,
            modalCount: shellMain.modalCount,
            quickSettingsOpen: quickSettings().menu.isOpen,
            powerMenuOpen: powerMenu().isOpen,
        };
    }

    async refresh(): Promise<void> {
        await target()._monitor?.refresh();
        await wait(200);
    }

    async dismissStartupUi(): Promise<void> {
        for (const child of Main.layoutManager.modalDialogGroup.get_children())
            (child as unknown as {close?(): void}).close?.();
        shellMain.overview.hide();
        await wait(1000);
        this._pointer.notify_absolute_motion(GLib.get_monotonic_time(), 640, 400);
        await wait(200);
    }

    async openPowerMenu(): Promise<void> {
        if (!quickSettings().menu.isOpen) {
            quickSettings().menu.open();
            await wait(500);
        }
        if (!powerMenu().isOpen) {
            powerMenu().open();
            await wait(800);
        }
    }

    async closeMenus(): Promise<void> {
        quickSettings().menu.close();
        await wait(500);
    }

    async click(actor: Clutter.Actor): Promise<void> {
        const [x, y] = centerOf(actor);
        this._pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        await wait(100);
        this._pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await wait(80);
        this._pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await wait(400);
    }

    // Virtual pointer events are occasionally dropped in a headless shell, so
    // retry on the observed outcome rather than on the event itself.
    private async _clickInPowerMenu(actor: () => Clutter.Actor, done: () => boolean): Promise<number> {
        for (let attempt = 1; attempt <= CLICK_ATTEMPTS; attempt++) {
            await this.openPowerMenu();
            await this.click(actor());
            if (done()) return attempt;
        }
        throw new Error(`click had no effect after ${CLICK_ATTEMPTS} attempts`);
    }

    async tap(actor: Clutter.Actor): Promise<void> {
        const [x, y] = centerOf(actor);
        this._touch.notify_touch_down(GLib.get_monotonic_time(), 0, x, y);
        await wait(80);
        this._touch.notify_touch_up(GLib.get_monotonic_time(), 0);
        await wait(600);
    }

    clickBadge(): Promise<number> {
        return this._clickInPowerMenu(
            () => target()._badge!,
            () => Boolean(target()._dialog)
        );
    }

    clickSuspendLabel(): Promise<number> {
        const before = this.suspendCalls;
        return this._clickInPowerMenu(
            () => suspendItem().label,
            () => this.suspendCalls > before
        );
    }

    tapBadge(): Promise<void> {
        return this.tap(target()._badge!);
    }

    async pressKey(name: 'Escape' | 'Return'): Promise<void> {
        const keyval = name === 'Escape' ? Clutter.KEY_Escape : Clutter.KEY_Return;
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        await wait(50);
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        await wait(600);
    }

    focusBadge(): boolean {
        target()._badge!.grab_key_focus();
        return global.stage.key_focus === target()._badge;
    }

    focusSuspendItem(): boolean {
        suspendItem().grab_key_focus();
        return global.stage.key_focus === suspendItem();
    }

    async setEnabled(enabled: boolean): Promise<void> {
        if (enabled) Main.extensionManager.enableExtension(TARGET_UUID);
        else Main.extensionManager.disableExtension(TARGET_UUID);
        await wait(800);
    }

    async setColorScheme(scheme: 'prefer-dark' | 'prefer-light'): Promise<string | null> {
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string('color-scheme', scheme);
        await wait(1500);
        return stylesheetName();
    }

    async screenshot(path: string): Promise<void> {
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }
}

declare global {
    var __suspendInhibitorsE2E: TestApi | undefined;
}

export default class E2eHelperExtension extends Extension {
    override enable(): void {
        global.context.unsafe_mode = true;

        const api = new TestApi();
        const intercept = () => {
            api.suspendCalls++;
            console.log('e2e: Suspend intercepted');
        };
        const systemActions = SystemActions.getDefault() as unknown as {activateSuspend: () => void};
        const loginManager = getLoginManager();
        systemActions.activateSuspend = intercept;
        loginManager.suspend = intercept;
        api.patched = systemActions.activateSuspend === intercept && loginManager.suspend === intercept;

        globalThis.__suspendInhibitorsE2E = api;
    }

    override disable(): void {
        globalThis.__suspendInhibitorsE2E = undefined;
    }
}

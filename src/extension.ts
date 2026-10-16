import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {InhibitorBadge} from './lib/badge.js';
import {InhibitorDialog} from './lib/dialog.js';
import {InhibitorMonitor} from './lib/monitor.js';

type PowerMenu = PopupMenu.PopupMenuBase;

export default class SuspendInhibitorIndicatorExtension extends Extension {
    private _indicatorAddedId = 0;
    private _menu: PowerMenu | null = null;
    private _menuOpenId = 0;
    private _monitor: InhibitorMonitor | null = null;
    private _spacer: St.Widget | null = null;
    private _badge: InhibitorBadge | null = null;
    private _dialog: InhibitorDialog | null = null;

    override enable(): void {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings._system) {
            this._attach(quickSettings._system._systemItem.menu);
            return;
        }

        // Quick settings creates its indicators asynchronously during startup.
        this._indicatorAddedId = quickSettings._indicators.connect('child-added', () => {
            if (!quickSettings._system) return;
            quickSettings._indicators.disconnect(this._indicatorAddedId);
            this._indicatorAddedId = 0;
            this._attach(quickSettings._system._systemItem.menu);
        });
    }

    override disable(): void {
        if (this._indicatorAddedId) {
            Main.panel.statusArea.quickSettings._indicators.disconnect(this._indicatorAddedId);
            this._indicatorAddedId = 0;
        }

        if (this._dialog) {
            this._dialog.popModal();
            this._dialog.destroy();
        }

        this._menu?.disconnect(this._menuOpenId);
        this._badge?.destroy();
        this._spacer?.destroy();
        this._monitor?.destroy();

        this._menu = null;
        this._menuOpenId = 0;
        this._badge = null;
        this._spacer = null;
        this._monitor = null;
    }

    private _attach(menu: PowerMenu): void {
        const suspendItem = menu.firstMenuItem as PopupMenu.PopupBaseMenuItem;
        const monitor = new InhibitorMonitor(() => this._sync());

        this._menu = menu;
        this._monitor = monitor;
        this._spacer = new St.Widget({x_expand: true});
        this._badge = new InhibitorBadge();
        this._badge.connect('clicked', () => this._openDialog());
        suspendItem.add_child(this._spacer);
        suspendItem.add_child(this._badge);

        this._menuOpenId = menu.connect('open-state-changed', (_menu, open) => {
            if (open) void monitor.refresh();
            this._updatePolling();
        });
        this._updatePolling();
    }

    private _updatePolling(): void {
        this._monitor?.setPolling(this._menu?.isOpen === true || this._dialog !== null);
    }

    private _sync(): void {
        if (!this._monitor) return;
        const {inhibitors, failed} = this._monitor;
        this._badge?.update(inhibitors.length, failed.length > 0);
        this._dialog?.update();
    }

    private _openDialog(): void {
        if (!this._monitor) return;
        Main.panel.closeQuickSettings();

        const dialog = new InhibitorDialog(this._monitor);
        dialog.connect('destroy', () => {
            this._dialog = null;
            this._updatePolling();
        });
        this._dialog = dialog;

        if (!dialog.open()) {
            dialog.destroy();
            return;
        }
        this._updatePolling();
        void this._monitor.refresh();
    }
}

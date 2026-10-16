import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import type {InhibitorSource, QuerySource} from './inhibitor.js';
import type {InhibitorMonitor} from './monitor.js';

function sourceLabel(source: InhibitorSource): string {
    switch (source) {
        case 'session':
            return _('GNOME session');
        case 'block-weak':
            return _('systemd (weak lock)');
        case 'block':
            return _('systemd');
    }
}

function queryLabel(source: QuerySource): string {
    return source === 'session' ? _('GNOME session') : _('systemd-logind');
}

function wrappedLabel(text: string, styleClass: string): St.Label {
    const label = new St.Label({text, style_class: styleClass, x_expand: true});
    label.clutter_text.line_wrap = true;
    return label;
}

export class InhibitorDialog extends ModalDialog.ModalDialog {
    static {
        GObject.registerClass(this);
    }

    declare private _monitor: InhibitorMonitor;
    declare private _content: Dialog.MessageDialogContent;
    declare private _rows: St.BoxLayout;

    constructor(monitor: InhibitorMonitor) {
        super({styleClass: 'suspend-inhibitors-dialog', destroyOnClose: true});
        this._monitor = monitor;

        this._content = new Dialog.MessageDialogContent({title: _('Suspend Inhibitors')});
        this.contentLayout.add_child(this._content);

        this._rows = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'suspend-inhibitors-rows',
            x_expand: true,
        });
        const scroll = new St.ScrollView({
            style_class: 'suspend-inhibitors-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
        });
        scroll.set_child(this._rows);
        this.contentLayout.add_child(scroll);

        this.addButton({
            label: _('Close'),
            action: () => this.close(),
            key: Clutter.KEY_Escape,
            default: true,
        });

        this.update();
    }

    update(): void {
        const {inhibitors, failed} = this._monitor;

        if (inhibitors.length) this._content.description = _('These are currently inhibiting suspend.');
        else if (failed.length) this._content.description = '';
        else this._content.description = _('Nothing is inhibiting suspend right now.');

        this._rows.destroy_all_children();
        for (const {app, reason, source} of inhibitors) {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'suspend-inhibitors-row',
                x_expand: true,
            });
            row.add_child(wrappedLabel(app ?? _('Unknown application'), 'suspend-inhibitors-app'));
            row.add_child(wrappedLabel(reason || _('No reason given'), 'suspend-inhibitors-reason'));
            row.add_child(wrappedLabel(sourceLabel(source), 'suspend-inhibitors-source'));
            this._rows.add_child(row);
        }

        if (failed.length) {
            const sources = failed.map(queryLabel).join(', ');
            this._rows.add_child(
                wrappedLabel(
                    _('Could not query %s. The list may be incomplete.').format(sources),
                    'suspend-inhibitors-error'
                )
            );
        }
    }
}

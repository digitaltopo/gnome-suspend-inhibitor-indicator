import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {badgeState} from './inhibitor.js';

export class InhibitorBadge extends St.Button {
    static {
        GObject.registerClass(this);
    }

    declare private _count: St.Label;

    constructor() {
        super({
            style_class: 'suspend-inhibitors-badge',
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        const box = new St.BoxLayout({style_class: 'suspend-inhibitors-badge-content'});
        box.add_child(
            new St.Icon({
                icon_name: 'dialog-warning-symbolic',
                style_class: 'suspend-inhibitors-badge-icon',
            })
        );
        this._count = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._count);
        this.set_child(box);
    }

    update(count: number, incomplete: boolean): void {
        const state = badgeState(count, incomplete);
        this.visible = state.visible;
        this._count.text = state.text;

        switch (state.status) {
            case 'complete':
                this.accessible_name = ngettext(
                    'View %d suspend inhibitor',
                    'View %d suspend inhibitors',
                    count
                ).format(count);
                break;
            case 'partial':
                this.accessible_name = ngettext(
                    'View %d suspend inhibitor, the list may be incomplete',
                    'View %d suspend inhibitors, the list may be incomplete',
                    count
                ).format(count);
                break;
            case 'unknown':
                this.accessible_name = _('Unable to check suspend inhibitors');
                break;
        }
    }
}

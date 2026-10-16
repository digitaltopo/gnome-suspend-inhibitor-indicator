import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {Inhibitor, QuerySource} from './inhibitor.js';
import {LOGIN_IFACE, LOGIN_NAME, LOGIN_PATH, SESSION_NAME, SESSION_PATH, queryLogind, querySession} from './queries.js';

// logind only signals when the set of inhibited operations changes, so a second
// lock on 'sleep' goes unnoticed. Poll while the result is on screen.
const POLL_INTERVAL_SECONDS = 15;

const LOGIND_BLOCK_PROPERTIES = ['BlockInhibited', 'BlockWeakInhibited'];

export class InhibitorMonitor {
    inhibitors: Inhibitor[] = [];
    failed: QuerySource[] = [];

    private _onChanged: () => void;
    private _cancellable = new Gio.Cancellable();
    private _subscriptions: [Gio.DBusConnection, number][];
    private _pollId = 0;
    private _busy = false;
    private _queued = false;
    private _key = '';

    constructor(onChanged: () => void) {
        this._onChanged = onChanged;
        this._subscriptions = [
            [
                Gio.DBus.session,
                Gio.DBus.session.signal_subscribe(
                    SESSION_NAME,
                    SESSION_NAME,
                    null,
                    SESSION_PATH,
                    null,
                    Gio.DBusSignalFlags.NONE,
                    (_connection, _sender, _path, _iface, signal) => {
                        if (signal === 'InhibitorAdded' || signal === 'InhibitorRemoved') void this.refresh();
                    }
                ),
            ],
            [
                Gio.DBus.system,
                Gio.DBus.system.signal_subscribe(
                    LOGIN_NAME,
                    'org.freedesktop.DBus.Properties',
                    'PropertiesChanged',
                    LOGIN_PATH,
                    LOGIN_IFACE,
                    Gio.DBusSignalFlags.NONE,
                    (_connection, _sender, _path, _iface, _signal, parameters) => {
                        const [, changed, invalidated] = parameters.deep_unpack() as [
                            string,
                            Record<string, unknown>,
                            string[],
                        ];
                        if (LOGIND_BLOCK_PROPERTIES.some(name => name in changed || invalidated.includes(name)))
                            void this.refresh();
                    }
                ),
            ],
        ];

        void this.refresh();
    }

    setPolling(enabled: boolean): void {
        if (this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = 0;
        }
        if (enabled) {
            this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_SECONDS, () => {
                void this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    async refresh(): Promise<void> {
        if (this._busy) {
            this._queued = true;
            return;
        }
        this._busy = true;

        const cancellable = this._cancellable;
        const [session, logind] = await Promise.allSettled([querySession(cancellable), queryLogind(cancellable)]);
        if (cancellable.is_cancelled()) return;

        this._busy = false;
        const failed: QuerySource[] = [];
        if (session.status === 'rejected') failed.push('session');
        if (logind.status === 'rejected') failed.push('logind');
        this._update(
            [session, logind].flatMap(result => (result.status === 'fulfilled' ? result.value : [])),
            failed
        );

        if (this._queued) {
            this._queued = false;
            void this.refresh();
        }
    }

    private _update(inhibitors: Inhibitor[], failed: QuerySource[]): void {
        const key = JSON.stringify([inhibitors, failed]);
        if (key === this._key) return;

        this._key = key;
        this.inhibitors = inhibitors;
        this.failed = failed;
        this._onChanged();
    }

    destroy(): void {
        this._cancellable.cancel();
        this.setPolling(false);
        for (const [bus, id] of this._subscriptions) bus.signal_unsubscribe(id);
        this._subscriptions = [];
    }
}

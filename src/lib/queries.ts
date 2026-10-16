import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';

import {
    type Inhibitor,
    type LogindInhibitor,
    desktopIdFor,
    fallbackAppName,
    isSuspendInhibitor,
    suspendInhibitingLocks,
} from './inhibitor.js';
import {callDBus} from './dbus.js';

export const SESSION_NAME = 'org.gnome.SessionManager';
export const SESSION_PATH = '/org/gnome/SessionManager';
const SESSION_INHIBITOR_IFACE = 'org.gnome.SessionManager.Inhibitor';

export const LOGIN_NAME = 'org.freedesktop.login1';
export const LOGIN_PATH = '/org/freedesktop/login1';
export const LOGIN_IFACE = 'org.freedesktop.login1.Manager';

function appName(appId: string): string | null {
    if (!appId) return null;
    return GioUnix.DesktopAppInfo.new(desktopIdFor(appId))?.get_name() ?? fallbackAppName(appId);
}

async function querySessionInhibitor(path: string, cancellable: Gio.Cancellable): Promise<Inhibitor | null> {
    const call = <T>(method: string) =>
        callDBus<T>(Gio.DBus.session, SESSION_NAME, path, SESSION_INHIBITOR_IFACE, method, cancellable);

    if (!isSuspendInhibitor(await call<number>('GetFlags'))) return null;

    const [appId, reason] = await Promise.all([call<string>('GetAppId'), call<string>('GetReason')]);
    return {app: appName(appId), reason, source: 'session'};
}

export async function querySession(cancellable: Gio.Cancellable): Promise<Inhibitor[]> {
    const paths = await callDBus<string[]>(
        Gio.DBus.session,
        SESSION_NAME,
        SESSION_PATH,
        SESSION_NAME,
        'GetInhibitors',
        cancellable
    );

    // An inhibitor can be released between GetInhibitors and the calls below.
    const rows = await Promise.allSettled(paths.map(path => querySessionInhibitor(path, cancellable)));
    return rows.flatMap(row => (row.status === 'fulfilled' && row.value ? [row.value] : []));
}

export async function queryLogind(cancellable: Gio.Cancellable): Promise<Inhibitor[]> {
    const rows = await callDBus<LogindInhibitor[]>(
        Gio.DBus.system,
        LOGIN_NAME,
        LOGIN_PATH,
        LOGIN_IFACE,
        'ListInhibitors',
        cancellable
    );
    return suspendInhibitingLocks(rows, new Gio.Credentials().get_unix_user());
}

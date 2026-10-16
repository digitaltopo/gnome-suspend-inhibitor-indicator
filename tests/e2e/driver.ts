import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import type {Status} from './helper/extension.js';

const SCREENSHOT_DIR = GLib.getenv('E2E_SCREENSHOTS') ?? '/tmp';
const SKIP_LOGIND = GLib.getenv('E2E_SKIP_LOGIND') === '1';
const API = 'globalThis.__suspendInhibitorsE2E';
const SESSION_FLAG_SUSPEND = 4;
const SESSION_FLAG_IDLE = 8;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function call(
    name: string,
    path: string,
    iface: string,
    method: string,
    args: GLib.Variant | null
): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(name, path, iface, method, args, null, Gio.DBusCallFlags.NONE, 30000, null, (_c, res) => {
            try {
                resolve(Gio.DBus.session.call_finish(res).deep_unpack() as unknown[]);
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function shell<T>(code: string): Promise<T> {
    const [ok, json] = (await call(
        'org.gnome.Shell',
        '/org/gnome/Shell',
        'org.gnome.Shell',
        'Eval',
        new GLib.Variant('(s)', [code])
    )) as [boolean, string];
    if (!ok) throw new Error(`Eval failed: ${json}`);
    return (json ? JSON.parse(json) : undefined) as T;
}

function api<T>(expression: string): Promise<T> {
    return shell<T>(`${API}.${expression}`);
}

function status(): Promise<Status> {
    return api<Status>('status()');
}

async function inhibitSession(appId: string, reason: string, flags: number): Promise<number> {
    const [cookie] = (await call(
        'org.gnome.SessionManager',
        '/org/gnome/SessionManager',
        'org.gnome.SessionManager',
        'Inhibit',
        new GLib.Variant('(susu)', [appId, 0, reason, flags])
    )) as [number];
    await sleep(400);
    return cookie;
}

async function uninhibitSession(cookie: number): Promise<void> {
    await call(
        'org.gnome.SessionManager',
        '/org/gnome/SessionManager',
        'org.gnome.SessionManager',
        'Uninhibit',
        new GLib.Variant('(u)', [cookie])
    );
    await sleep(400);
}

async function logindLock(mode: string, who: string, why: string): Promise<Gio.Subprocess> {
    const process = Gio.Subprocess.new(
        ['systemd-inhibit', '--what=sleep', `--mode=${mode}`, `--who=${who}`, `--why=${why}`, 'sleep', '120'],
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
    );
    await sleep(800);
    return process;
}

async function releaseLock(process: Gio.Subprocess): Promise<void> {
    process.force_exit();
    await sleep(800);
}

async function waitFor<T>(what: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    let value = await read();
    while (!done(value)) {
        if (GLib.get_monotonic_time() > deadline)
            throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
        await sleep(200);
        value = await read();
    }
    return value;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, body: () => Promise<void>) => tests.push([name, body]);

let baseline = 0;
const cookies: number[] = [];
const locks: Gio.Subprocess[] = [];

test('helper intercepts Suspend so no test can suspend the machine', async () => {
    assertEqual(await api<boolean>('patched'), true, 'Suspend interception');
    await api('dismissStartupUi()');
});

test('extension is active and attached to the Suspend item', async () => {
    const s = await status();
    assertEqual(s.state, 1, 'extension state (ACTIVE)');
    assertEqual(s.error, null, 'extension error');
    assertEqual(s.stylesheet, 'stylesheet-dark.css', 'dark style sheet');
    assert(s.attached, 'attached to the power menu');
    assertEqual(s.itemLabel, 'Suspend', 'first power menu item');
    assertEqual(s.itemChildren.slice(-2), ['St_Widget', 'InhibitorBadge'], 'badge appended to the Suspend item');
    baseline = Number.parseInt(s.badge!.text, 10) || 0;
    assertEqual(s.badge!.visible, baseline > 0, 'badge hidden only when nothing inhibits suspend');
});

test('GNOME session suspend inhibitor shows on the badge', async () => {
    cookies.push(await inhibitSession('org.gnome.Totem', 'Playing video', SESSION_FLAG_SUSPEND));
    const s = await waitFor('badge count', status, v => v.badge?.text === `${baseline + 1}`);
    assert(s.badge!.visible, 'badge visible');
    assert(s.badge!.accessibleName.startsWith(`View ${baseline + 1} suspend inhibitor`), 'accessible name');
});

test('idle-only session inhibitor is ignored', async () => {
    cookies.push(await inhibitSession('org.mozilla.firefox', 'Idle only', SESSION_FLAG_IDLE));
    assertEqual((await status()).badge!.text, `${baseline + 1}`, 'count unchanged');
});

test('logind block lock shows; block-weak by the same user and delay do not', async () => {
    if (SKIP_LOGIND) return;
    locks.push(await logindLock('block', 'SuspendTest', 'Testing systemd suspend detection'));
    await waitFor('logind block', status, v => v.badge?.text === `${baseline + 2}`);
    locks.push(await logindLock('block-weak', 'WeakTest', 'weak'), await logindLock('delay', 'DelayTest', 'delay'));
    await api('refresh()');
    assertEqual((await status()).badge!.text, `${baseline + 2}`, 'count unchanged by block-weak and delay');
});

test('clicking the badge opens the dialog without suspending', async () => {
    await api('openPowerMenu()');
    assert((await status()).polling, 'polls while the power menu is open');
    await api('screenshot("' + `${SCREENSHOT_DIR}/menu-dark.png` + '")');
    const before = (await status()).suspendCalls;
    await api('clickBadge()');
    const s = await waitFor('dialog', status, v => v.dialog !== null);
    assertEqual(s.suspendCalls, before, 'Suspend not triggered');
    assert(!s.quickSettingsOpen, 'quick settings closed');
    const apps = s.dialog!.rows.map(row => row[0]);
    assert(apps.includes('Videos'), `session inhibitor listed with its app name: ${JSON.stringify(apps)}`);
    if (!SKIP_LOGIND) assert(apps.includes('SuspendTest'), 'logind inhibitor listed');
    assert(!apps.includes('Firefox'), 'idle-only inhibitor not listed');
    assertEqual(s.dialog!.description, 'These are currently inhibiting suspend.', 'description');
    await api('screenshot("' + `${SCREENSHOT_DIR}/dialog-dark.png` + '")');
});

test('dialog updates live while open', async () => {
    cookies.push(await inhibitSession('org.gnome.Nautilus', 'Copying files', SESSION_FLAG_SUSPEND | SESSION_FLAG_IDLE));
    await waitFor('new row', status, v => Boolean(v.dialog?.rows.some(row => row[0] === 'Files')));
});

test('Escape closes the dialog and stops polling', async () => {
    await api('pressKey("Escape")');
    const s = await waitFor('dialog closed', status, v => v.dialog === null);
    assert(!s.polling, 'polling stopped');
});

test('tapping the badge opens the dialog without suspending', async () => {
    const before = (await status()).suspendCalls;
    await api('openPowerMenu()');
    await api('tapBadge()');
    const s = await waitFor('dialog', status, v => v.dialog !== null);
    assertEqual(s.suspendCalls, before, 'Suspend not triggered');
    await api('pressKey("Escape")');
});

test('clicking the Suspend label still suspends', async () => {
    const before = (await status()).suspendCalls;
    await api('openPowerMenu()');
    await api('clickSuspendLabel()');
    await waitFor('Suspend', status, v => v.suspendCalls === before + 1);
});

test('keyboard: Return on the badge opens the dialog, Return on the item suspends', async () => {
    await api('openPowerMenu()');
    assert(await api<boolean>('focusBadge()'), 'badge focusable');
    const before = (await status()).suspendCalls;
    await api('pressKey("Return")');
    let s = await waitFor('dialog', status, v => v.dialog !== null);
    assertEqual(s.suspendCalls, before, 'Suspend not triggered from the badge');
    await api('pressKey("Escape")');

    await api('openPowerMenu()');
    assert(await api<boolean>('focusSuspendItem()'), 'item focusable');
    await api('pressKey("Return")');
    s = await waitFor('Suspend', status, v => v.suspendCalls === before + 1);
    assertEqual(s.dialog, null, 'no dialog from the item');
});

test('light style loads stylesheet-light.css', async () => {
    assertEqual(await api<string>('setColorScheme("prefer-light")'), 'stylesheet-light.css', 'light style sheet');
    await api('openPowerMenu()');
    await api('screenshot("' + `${SCREENSHOT_DIR}/menu-light.png` + '")');
    await api('clickBadge()');
    await waitFor('dialog', status, v => v.dialog !== null);
    await api('screenshot("' + `${SCREENSHOT_DIR}/dialog-light.png` + '")');
    await api('pressKey("Escape")');
    assertEqual(await api<string>('setColorScheme("prefer-dark")'), 'stylesheet-dark.css', 'dark style sheet');
});

test('disabling with the dialog open cleans up, and re-enabling works', async () => {
    await api('openPowerMenu()');
    await api('clickBadge()');
    const open = await waitFor('dialog', status, v => v.dialog !== null);
    for (let i = 0; i < 2; i++) {
        await api('setEnabled(false)');
        let s = await status();
        assertEqual(s.state, 2, 'extension state (INACTIVE)');
        assertEqual(s.itemChildren, ['St_Icon', 'St_Label'], 'Suspend item restored');
        assertEqual(s.modalCount, open.modalCount - 1, 'modal grab released');
        await api('setEnabled(true)');
        s = await waitFor('reattached', status, v => v.attached && v.badge !== null);
        assertEqual(s.state, 1, 'extension state (ACTIVE)');
        assertEqual(s.itemChildren.slice(-2), ['St_Widget', 'InhibitorBadge'], 'badge reattached');
    }
});

test('released inhibitors disappear from the badge', async () => {
    while (cookies.length) await uninhibitSession(cookies.pop()!);
    while (locks.length) await releaseLock(locks.pop()!);
    await api('refresh()');
    await waitFor('baseline', status, v => v.badge?.text === `${baseline}`);
});

test('an unreachable session manager is reported as an incomplete list', async () => {
    await call('org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager', 'Quit', null);
    await sleep(500);
    await api('refresh()');
    const s = await waitFor(
        'incomplete badge',
        status,
        v => v.badge?.text.endsWith('+') === true || v.badge?.text === '?'
    );
    assert(s.badge!.visible, 'badge visible');
    assert(
        s.badge!.accessibleName.includes('may be incomplete') || s.badge!.accessibleName.startsWith('Unable'),
        'accessible name mentions incomplete results'
    );
});

async function main(): Promise<number> {
    await waitFor(
        'the helper inside the shell',
        () => shell<boolean>(`Boolean(${API})`).catch(() => false),
        Boolean,
        60000
    );

    let failures = 0;
    print(`1..${tests.length}`);
    for (const [index, [name, body]] of tests.entries()) {
        try {
            await body();
            print(`ok ${index + 1} - ${name}`);
        } catch (error) {
            failures++;
            print(`not ok ${index + 1} - ${name}`);
            print(`  # ${String(error)}`);
        }
    }
    for (const lock of locks) lock.force_exit();
    return failures ? 1 : 0;
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 1;
main()
    .then(code => (exitCode = code))
    .catch((error: unknown) => printerr(String(error)))
    .finally(() => loop.quit());
await loop.runAsync();
System.exit(exitCode);

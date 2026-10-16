import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
    type LogindInhibitor,
    badgeState,
    desktopIdFor,
    fallbackAppName,
    isSuspendInhibitor,
    suspendInhibitingLocks,
} from '../../src/lib/inhibitor.ts';

const UID = 1000;
const OTHER_UID = 0;

function lock(what: string, who: string, why: string, mode: string, uid = UID): LogindInhibitor {
    return [what, who, why, mode, uid, 4242];
}

describe('isSuspendInhibitor', () => {
    it('accepts the GNOME session suspend flag alone or combined', () => {
        assert.equal(isSuspendInhibitor(4), true);
        assert.equal(isSuspendInhibitor(4 | 8), true);
        assert.equal(isSuspendInhibitor(1 | 2 | 4 | 8 | 16), true);
    });

    it('rejects logout, user switching, idle and automount flags', () => {
        for (const flags of [0, 1, 2, 8, 16, 1 | 2 | 8 | 16])
            assert.equal(isSuspendInhibitor(flags), false, `${flags}`);
    });
});

describe('desktopIdFor / fallbackAppName', () => {
    it('appends .desktop only when missing', () => {
        assert.equal(desktopIdFor('org.gnome.Totem'), 'org.gnome.Totem.desktop');
        assert.equal(desktopIdFor('firefox.desktop'), 'firefox.desktop');
    });

    it('strips .desktop for display', () => {
        assert.equal(fallbackAppName('com.example.App.desktop'), 'com.example.App');
        assert.equal(fallbackAppName('com.example.App'), 'com.example.App');
    });
});

describe('suspendInhibitingLocks', () => {
    it('keeps block locks on sleep from any user, including the caller', () => {
        const rows = [
            lock('sleep', 'SuspendTest', 'Testing', 'block'),
            lock('sleep', 'backupd', 'Backing up', 'block', OTHER_UID),
        ];
        assert.deepEqual(suspendInhibitingLocks(rows, UID), [
            {app: 'SuspendTest', reason: 'Testing', source: 'block'},
            {app: 'backupd', reason: 'Backing up', source: 'block'},
        ]);
    });

    it('matches sleep inside a combined what list', () => {
        const rows = [lock('shutdown:sleep:idle', 'Updater', 'Installing', 'block')];
        assert.equal(suspendInhibitingLocks(rows, UID).length, 1);
    });

    it('ignores locks that do not cover sleep', () => {
        const rows = [
            lock('shutdown', 'code', 'Clean shutdown', 'block'),
            lock('handle-lid-switch', 'gsd-power', 'External monitor', 'block'),
            lock('handle-power-key:handle-suspend-key', 'gsd-media-keys', 'Keys', 'block'),
            lock('idle', 'player', 'Playing', 'block'),
        ];
        assert.deepEqual(suspendInhibitingLocks(rows, UID), []);
    });

    it('ignores delay locks', () => {
        const rows = [lock('sleep', 'NetworkManager', 'Turn off networks', 'delay', OTHER_UID)];
        assert.deepEqual(suspendInhibitingLocks(rows, UID), []);
    });

    it('ignores block-weak locks owned by the caller, keeps those owned by others', () => {
        const rows = [
            lock('sleep', 'Mine', 'weak', 'block-weak', UID),
            lock('sleep', 'Theirs', 'weak', 'block-weak', OTHER_UID),
        ];
        assert.deepEqual(suspendInhibitingLocks(rows, UID), [{app: 'Theirs', reason: 'weak', source: 'block-weak'}]);
    });

    it("drops gnome-session's own mirror lock for the caller only", () => {
        const rows = [
            lock('sleep', 'orestis', 'user session inhibited', 'block', UID),
            lock('sleep', 'gdm', 'user session inhibited', 'block', 42),
        ];
        assert.deepEqual(suspendInhibitingLocks(rows, UID), [
            {app: 'gdm', reason: 'user session inhibited', source: 'block'},
        ]);
    });

    it('maps an empty who to null', () => {
        assert.equal(suspendInhibitingLocks([lock('sleep', '', 'x', 'block')], UID)[0]?.app, null);
    });
});

describe('badgeState', () => {
    it('is hidden with nothing to report', () => {
        assert.deepEqual(badgeState(0, false), {visible: false, text: '0', status: 'complete'});
    });

    it('shows the count when every source answered', () => {
        assert.deepEqual(badgeState(3, false), {visible: true, text: '3', status: 'complete'});
    });

    it('marks the count as a lower bound when a source failed', () => {
        assert.deepEqual(badgeState(2, true), {visible: true, text: '2+', status: 'partial'});
    });

    it('shows a question mark when nothing could be determined', () => {
        assert.deepEqual(badgeState(0, true), {visible: true, text: '?', status: 'unknown'});
    });
});

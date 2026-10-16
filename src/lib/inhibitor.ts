export type InhibitorSource = 'session' | 'block' | 'block-weak';
export type QuerySource = 'session' | 'logind';

export interface Inhibitor {
    app: string | null;
    reason: string;
    source: InhibitorSource;
}

export type LogindInhibitor = [what: string, who: string, why: string, mode: string, uid: number, pid: number];

export interface BadgeState {
    visible: boolean;
    text: string;
    status: 'complete' | 'partial' | 'unknown';
}

const SESSION_FLAG_SUSPEND = 4;

// gnome-session holds one logind lock with this reason on behalf of all of its
// suspend inhibitors, which are already listed individually from the session bus.
const SESSION_MIRROR_REASON = 'user session inhibited';

export function isSuspendInhibitor(flags: number): boolean {
    return (flags & SESSION_FLAG_SUSPEND) !== 0;
}

export function desktopIdFor(appId: string): string {
    return appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
}

export function fallbackAppName(appId: string): string {
    return appId.replace(/\.desktop$/, '');
}

// Follows logind's rules for Suspend (systemd 257+): 'block' applies to every
// user, 'block-weak' does not apply to its owner, and 'delay' only postpones it.
export function suspendInhibitingLocks(rows: LogindInhibitor[], uid: number): Inhibitor[] {
    return rows
        .filter(
            ([what, , why, mode, ownerUid]) =>
                what.split(':').includes('sleep') &&
                (mode === 'block' || (mode === 'block-weak' && ownerUid !== uid)) &&
                !(ownerUid === uid && why === SESSION_MIRROR_REASON)
        )
        .map(([, who, why, mode]) => ({
            app: who || null,
            reason: why,
            source: mode as InhibitorSource,
        }));
}

export function badgeState(count: number, incomplete: boolean): BadgeState {
    if (!incomplete) return {visible: count > 0, text: `${count}`, status: 'complete'};
    if (count > 0) return {visible: true, text: `${count}+`, status: 'partial'};
    return {visible: true, text: '?', status: 'unknown'};
}

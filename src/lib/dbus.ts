import Gio from 'gi://Gio';

const CALL_TIMEOUT_MS = 2500;

export function callDBus<T>(
    bus: Gio.DBusConnection,
    name: string,
    path: string,
    iface: string,
    method: string,
    cancellable: Gio.Cancellable
): Promise<T> {
    return new Promise((resolve, reject) => {
        bus.call(
            name,
            path,
            iface,
            method,
            null,
            null,
            Gio.DBusCallFlags.NONE,
            CALL_TIMEOUT_MS,
            cancellable,
            (_connection, result) => {
                try {
                    const reply = bus.call_finish(result).deep_unpack() as [T];
                    resolve(reply[0]);
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

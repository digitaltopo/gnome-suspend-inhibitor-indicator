import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MANAGER_XML = `<node><interface name="org.gnome.SessionManager">
  <method name="Inhibit">
    <arg type="s" direction="in"/><arg type="u" direction="in"/>
    <arg type="s" direction="in"/><arg type="u" direction="in"/>
    <arg type="u" direction="out"/>
  </method>
  <method name="Uninhibit"><arg type="u" direction="in"/></method>
  <method name="GetInhibitors"><arg type="ao" direction="out"/></method>
  <method name="Quit"/>
  <signal name="InhibitorAdded"><arg type="o"/></signal>
  <signal name="InhibitorRemoved"><arg type="o"/></signal>
</interface></node>`;

const INHIBITOR_XML = `<node><interface name="org.gnome.SessionManager.Inhibitor">
  <method name="GetAppId"><arg type="s" direction="out"/></method>
  <method name="GetReason"><arg type="s" direction="out"/></method>
  <method name="GetFlags"><arg type="u" direction="out"/></method>
</interface></node>`;

const loop = new GLib.MainLoop(null, false);
const inhibitors = new Map<number, {path: string; object: Gio.DBusExportedObject}>();
let nextCookie = 1;

const manager = Gio.DBusExportedObject.wrapJSObject(MANAGER_XML, {
    Inhibit(appId: string, _xid: number, reason: string, flags: number): number {
        const cookie = nextCookie++;
        const path = `/org/gnome/SessionManager/Inhibitor${cookie}`;
        const object = Gio.DBusExportedObject.wrapJSObject(INHIBITOR_XML, {
            GetAppId: () => appId,
            GetReason: () => reason,
            GetFlags: () => flags,
        });
        object.export(Gio.DBus.session, path);
        inhibitors.set(cookie, {path, object});
        manager.emit_signal('InhibitorAdded', new GLib.Variant('(o)', [path]));
        return cookie;
    },
    Uninhibit(cookie: number): void {
        const entry = inhibitors.get(cookie);
        if (!entry) return;
        inhibitors.delete(cookie);
        entry.object.unexport();
        manager.emit_signal('InhibitorRemoved', new GLib.Variant('(o)', [entry.path]));
    },
    GetInhibitors: () => [...inhibitors.values()].map(entry => entry.path),
    Quit: () => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    },
});

manager.export(Gio.DBus.session, '/org/gnome/SessionManager');
Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.gnome.SessionManager', Gio.BusNameOwnerFlags.NONE, null, null);
loop.run();

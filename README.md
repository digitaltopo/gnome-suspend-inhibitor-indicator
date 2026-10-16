# Gnome Suspend Inhibitors Indicator

A GNOME Shell extension adds an indicator next to **Suspend** in power menu that shows how many suspend inhibitors are active. Clicking on the icon shows a modal with details on active inhibitors.

## What counts as a suspend inhibitor

The badge follows logind's rules for which locks apply to suspend (systemd 257 and later):

| Source                                                                             | Shown | Why                                                  |
| ---------------------------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| GNOME session inhibitor with the suspend flag (browsers, video players, Caffeine…) | Yes   | gnome-session turns these into a logind `block` lock |
| logind `block` lock on `sleep`, from any user (e.g. `systemd-inhibit`)             | Yes   | Applies to every user, including its owner           |
| logind `block-weak` lock on `sleep` held by another user                           | Yes   | Applies to everyone except its owner                 |
| logind `block-weak` lock on `sleep` held by you                                    | No    | logind does not apply it to its owner                |
| logind `delay` locks                                                               | No    | They only postpone suspend for a few seconds         |
| Idle-only, logout or shutdown inhibitors                                           | No    | They do not affect suspend                           |

gnome-session holds a single logind lock ("user session inhibited") on behalf of all of its inhibitors. That lock is hidden, because the apps behind it are listed individually.

If the GNOME session or logind cannot be queried, the badge shows `N+` (or `?`) and the dialog says the list may be incomplete.

## Requirements

- GNOME Shell 49 or higher (Wayland)
- systemd 257 or later. Older logind versions do not apply `block` locks to their owner, so the badge can list locks that do not apply to you.

## Install from a release

Download `gnome-suspend-inhibitor-indicator@digitaltopo.github.io.shell-extension.zip` from the
[latest release](https://github.com/digitaltopo/gnome-suspend-inhibitor-indicator/releases/latest), then:

```sh
gnome-extensions install --force gnome-suspend-inhibitor-indicator@digitaltopo.github.io.shell-extension.zip
```

Log out and back in, then enable it as below.

## Install from source

```sh
npm install
npm run install-extension
```

Log out and back in (GNOME Shell on Wayland cannot reload extensions), then enable it:

```sh
gnome-extensions enable gnome-suspend-inhibitor-indicator@digitaltopo.github.io
```

## Try it

```sh
# A logind lock, as an app or script would take it
systemd-inhibit --what=sleep --mode=block --who="SuspendTest" --why="Testing" sleep 120

# A GNOME session inhibitor, as a browser or video player would take it
gnome-session-inhibit --inhibit suspend --reason "Playing video" --app-id org.gnome.Totem sleep 120
```

Open the power menu while either command runs.

## Development

| Command                     | What it does                                              |
| --------------------------- | --------------------------------------------------------- |
| `npm run build`             | Compile to `dist/`                                        |
| `npm run pack`              | Build and create the extension zip in `build/`            |
| `npm run install-extension` | Pack and install for the current user                     |
| `npm run check`             | Typecheck, lint, format check and unit tests              |
| `npm test`                  | Unit tests                                                |
| `npm run test:e2e`          | End-to-end tests in a disposable headless GNOME Shell     |
| `npm run pot`               | Regenerate `po/*.pot` after changing translatable strings |
| `npm run format`            | Format with Prettier                                      |

### End-to-end tests

`npm run test:e2e` starts a headless GNOME Shell with its own session bus, settings and extension directory, so it does
not touch your running session. It loads the extension next to a test helper that replaces Suspend with a counter, then
drives the real UI with virtual pointer, touch and keyboard devices. The suite covers detection, the dialog, keyboard
access, light and dark styles, and enable/disable cleanup. Screenshots are saved to `build/e2e/screenshots/`.

The logind tests take short-lived real inhibitor locks with `systemd-inhibit`, which briefly inhibit suspend on your
machine. Set `E2E_SKIP_LOGIND=1` to skip them.

### Debugging

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

See the [GNOME Shell extension documentation](https://gjs.guide/extensions/) for more.

### Releasing

The version lives only in `package.json`. The build writes it into `dist/metadata.json` as `version-name`; the numeric
`version` is assigned by extensions.gnome.org on upload. Versions follow [semver](https://semver.org/), without
prerelease suffixes (`version-name` only allows letters, digits, spaces and periods).

```sh
npm version minor          # or patch / major: bumps package.json, commits and tags vX.Y.Z
git push --follow-tags
```

`npm version` first runs the `preversion` script: `npm run check` and the end-to-end tests. If either fails, nothing is
bumped or tagged. The end-to-end tests need a GNOME Shell 49+ machine, so they run here rather than in CI.

Pushing the tag runs [the release workflow](.github/workflows/release.yml), which checks that the tag matches
`package.json`, runs `npm run check`, packs the extension and publishes a GitHub release with the zip attached.

## License

[GPL-3.0-or-later](LICENSE)

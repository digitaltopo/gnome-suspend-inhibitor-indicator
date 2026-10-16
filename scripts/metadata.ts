// Writes dist/metadata.json with version-name taken from package.json, so the version only lives in one place.
import {readFileSync, writeFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = (path: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(path, root), 'utf8')) as Record<string, unknown>;

const version = readJson('package.json').version as string;

// extensions.gnome.org only accepts 1-16 letters, digits, spaces and periods, so prerelease tags like 1.0.0-beta.1 fail
if (!/^(?![. ]+$)[a-zA-Z0-9 .]{1,16}$/.test(version)) {
    throw new Error(`package.json version "${version}" is not a valid metadata.json version-name`);
}

const metadata = {...readJson('src/metadata.json'), 'version-name': version};
writeFileSync(new URL('dist/metadata.json', root), `${JSON.stringify(metadata, null, 4)}\n`);

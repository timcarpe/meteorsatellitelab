/** Package standalone HTML, matching source, licenses, and integrity metadata. */
import { readFile, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

await copyFile('dist/index.html', 'dist/meteor-station.html');
const files = {};
async function include(path, required = true) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (!required && error.code === 'ENOENT') return;
    throw error;
  }
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await include(`${path}/${name}`);
  } else files[path] = new Uint8Array(await readFile(path));
}
for (const path of [
  'src',
  'scripts',
  'tests',
  'api',
  'docs',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.txt',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.server.json',
  'vite.config.ts',
  'vercel.json',
  'index.html',
]) {
  await include(path);
}
// Deployment providers omit some repository-only files and empty directories.
// Required application and build sources above must always be present.
for (const path of ['public', '.github', '.gitignore', '.prettierignore']) {
  await include(path, false);
}
await writeFile('dist/meteor-station-source.zip', zipSync(files));
await copyFile('THIRD_PARTY_NOTICES.txt', 'dist/THIRD_PARTY_NOTICES.txt');
await copyFile('LICENSE', 'dist/LICENSE.txt');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entries = await Promise.all(
  ['meteor-station.html', 'meteor-station-source.zip'].map(async (path) => {
    const bytes = await readFile(`dist/${path}`);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  }),
);
await writeFile(
  'dist/metadata.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      application: 'Meteor Station',
      version: '0.1.0',
      builtAt: new Date().toISOString(),
      campus: 'VAS Sunrise',
      entries,
      validation: {
        liveV3: 'pending hardware connection',
        onAirIq: 'not yet tested',
        recordedFrames: 'passed',
        generatedIq: 'passed',
      },
    },
    null,
    2,
  ),
);
console.log('Packaged standalone station, corresponding source, and metadata.');

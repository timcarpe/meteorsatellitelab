/** Compile and run capture regressions; storage and USB are test stand-ins. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const directory = await mkdtemp(join(tmpdir(), 'meteor-capture-'));
const modules = ['model', 'storage', 'journal', 'zip', 'export'];
try {
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
      types: [],
      rootDir: resolve('src/meteor_station/capture'),
      outDir: join(directory, 'modules'),
    },
    files: modules.map((name) => resolve(`src/meteor_station/capture/${name}.ts`)),
  };
  const configPath = join(directory, 'tsconfig.json');
  await writeFile(configPath, JSON.stringify(config));
  // pnpm scripts put the pinned compiler on PATH; no compiler JavaScript API needed.
  await promisify(execFile)('tsc', ['-p', configPath], {
    shell: process.platform === 'win32',
  });
  for (const name of modules) {
    const file = join(directory, 'modules', `${name}.js`);
    const code = (await readFile(file, 'utf8')).replace(
      /from '(\.\/[^']+?)(?<!\.js)'/g,
      "from '$1.js'",
    );
    await writeFile(file, code);
  }
  await writeFile(
    join(directory, 'regressions.mjs'),
    await readFile('tests/capture/regressions.mjs', 'utf8'),
  );
  await import(pathToFileURL(join(directory, 'regressions.mjs')).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}

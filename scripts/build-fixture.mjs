import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';

mkdirSync('build/fixtures', { recursive: true });
const root = 'src/meteor_station/decoder/native/vendor/libcorrect';
const objects = [];
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Fixture generation failed: ${command}`);
}
for (const folder of ['convolutional', 'reed-solomon']) {
  for (const file of readdirSync(`${root}/src/${folder}`)) {
    if (!file.endsWith('.c')) continue;
    const object = `build/fixtures/${folder}-${file}.o`;
    run('clang', [
      '-O2',
      `-I${root}/include`,
      '-c',
      `${root}/src/${folder}/${file}`,
      '-o',
      object,
    ]);
    objects.push(object);
  }
}
run('clang++', [
  '-O2',
  '-std=c++17',
  `-I${root}/include`,
  'scripts/encode-fixture.cpp',
  ...objects,
  '-o',
  'build/fixtures/encode',
]);
run('build/fixtures/encode', [
  'tests/fixtures/meteor-recording.cadu',
  'build/fixtures/meteor-test',
  process.argv[2] ?? '2500',
]);

/** Rebuild the browser decoder with a pinned Emscripten toolchain. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const sdk = process.env.EMSDK;
if (!sdk) throw new Error('Set EMSDK to an activated Emscripten 4.0.23 directory.');
const root = resolve('src/meteor_station/decoder/native');
const build = resolve('build/native');
mkdirSync(build, { recursive: true });
mkdirSync('src/meteor_station/decoder/generated', { recursive: true });
const sources = [];
for (const folder of [
  'vendor/libcorrect/src/convolutional',
  'vendor/libcorrect/src/reed-solomon',
]) {
  for (const name of readdirSync(`${root}/${folder}`)) {
    if (name.endsWith('.c')) sources.push(`${root}/${folder}/${name}`);
  }
}
for (const file of readdirSync(`${root}/vendor/meteordemod/DSP`)) {
  if (file.endsWith('.cpp')) sources.push(`${root}/vendor/meteordemod/DSP/${file}`);
}
sources.push(`${root}/demod_bridge.cpp`);
for (const name of [
  'correlation',
  'viterbi',
  'reedsolomon',
  'deinterleaver',
  'meteordecoder',
]) {
  sources.push(`${root}/vendor/meteordemod/${name}.cpp`);
}
sources.push(`${root}/station.cpp`);
const includes = ['vendor/libcorrect/include', 'vendor/meteordemod'].map(
  (path) => `-I${root}/${path}`,
);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Decoder build failed: ${command}`);
}
const objects = sources.map((source, index) => {
  const object = `${build}/${index}-${basename(source)}.o`;
  run(`${sdk}/upstream/emscripten/${source.endsWith('.c') ? 'emcc' : 'em++'}`, [
    '-O3',
    '-DNDEBUG',
    '-include',
    'sys/types.h',
    ...includes,
    ...(source.endsWith('.cpp') ? ['-std=c++17', '-include', 'vector'] : []),
    '-c',
    source,
    '-o',
    object,
  ]);
  return object;
});
run(`${sdk}/upstream/emscripten/em++`, [
  ...objects,
  '-O3',
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sSINGLE_FILE=1',
  '-sENVIRONMENT=web,worker',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sMAXIMUM_MEMORY=134217728',
  '-sFILESYSTEM=0',
  '-sEXPORTED_FUNCTIONS=_malloc,_free,_station_init,_station_iq,_station_soft,_station_finish,_station_frames,_station_symbols,_station_symbol_count,_station_carrier_offset',
  '-sEXPORTED_RUNTIME_METHODS=HEAPU8',
  '-o',
  'src/meteor_station/decoder/generated/meteor-wasm.js',
]);

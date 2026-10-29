/** Exercise the exact browser WASM artifact against a traceable test waveform. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import createDecoder from '../src/meteor_station/decoder/generated/meteor-wasm.js';

const original = readFileSync('tests/fixtures/meteor-recording.cadu').subarray(
  0,
  160 * 1024,
);
const expected = new Map();
const key = (f) => `${f[5] & 63}-${f.readUIntBE(6, 3)}`;
for (let offset = 0; offset < original.length; offset += 1024) {
  const f = original.subarray(offset, offset + 1024);
  expected.set(key(f), f);
}
const reports = [];
for (const kind of ['soft', 'cu8', 'cu8-irregular', 'noise']) {
  const mod = await createDecoder({ print: () => {}, printErr: console.error });
  if (mod._station_init(288000) !== 0) throw new Error('WASM initialization failed.');
  let random = 1234567;
  const input =
    kind === 'noise'
      ? Buffer.from(
          Array.from({ length: 576000 }, () => {
            random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
            return random >>> 24;
          }),
        )
      : readFileSync(`build/fixtures/meteor-test.${kind === 'soft' ? 'soft' : 'cu8'}`);
  const pointer = mod._malloc(65536);
  let decoded = 0,
    mismatch = 0;
  const decodedFrames = [];
  const seen = new Set();
  const began = performance.now();
  const collect = (count) => {
    if (count < 0) throw new Error(`Decoder rejected ${kind} block: ${count}`);
    const start = mod._station_frames();
    for (let i = 0; i < count; i++) {
      const frame = Buffer.from(
        mod.HEAPU8.slice(start + i * 1024, start + (i + 1) * 1024),
      );
      const reference = expected.get(key(frame));
      if (!reference || !frame.subarray(0, 896).equals(reference.subarray(0, 896)))
        mismatch++;
      if (seen.has(key(frame))) throw new Error(`Duplicate CADU in ${kind}`);
      seen.add(key(frame));
      decoded++;
      decodedFrames.push(frame);
    }
  };
  let blockIndex = 0;
  const sizes = kind === 'cu8-irregular' ? [8190, 24578, 32766, 4098, 65536] : [65536];
  for (let offset = 0; offset < input.length;) {
    const block = input.subarray(offset, offset + sizes[blockIndex++ % sizes.length]);
    mod.HEAPU8.set(block, pointer);
    collect(
      kind === 'soft'
        ? mod._station_soft(pointer, block.length)
        : mod._station_iq(pointer, block.length),
    );
    offset += block.length;
  }
  collect(mod._station_finish());
  mod._free(pointer);
  const milliseconds = performance.now() - began;
  const report = {
    input: kind,
    bytes: input.length,
    decoded,
    mismatch,
    milliseconds,
    sourceSha256: createHash('sha256').update(input).digest('hex'),
    decodedSha256: createHash('sha256')
      .update(Buffer.concat(decodedFrames))
      .digest('hex'),
  };
  console.log(report);
  reports.push(report);
  writeFileSync(`build/fixtures/decoded-${kind}.cadu`, Buffer.concat(decodedFrames));
}
writeFileSync(
  'build/fixtures/validation.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sampleRate: 288000,
      description:
        'Generated noisy OQPSK IQ carrying independent recorded Meteor frames; not on-air IQ.',
      reports,
    },
    null,
    2,
  ),
);
if (
  reports.some((r) =>
    r.input === 'noise' ? r.decoded !== 0 : r.decoded < 120 || r.mismatch > 0,
  ) ||
  reports[1].decodedSha256 !== reports[2].decodedSha256
)
  process.exitCode = 1;

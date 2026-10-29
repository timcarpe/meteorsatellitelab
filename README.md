# Meteor Station — VAS Sunrise

A student browser station for planning Meteor passes around the Secondary school
day, checking an RTL-SDR Blog V3 on **96.5 MHz FM**, and receiving Meteor images.
The hosted page and downloadable HTML contain the same decoder. No student account,
audio server, radio proxy, or local decoder installation is required.

## Use

1. Open the hosted station, or download `meteor-station.html` and open it in
   desktop Chrome or Edge. Planning and recorded-data replay also work in browsers
   without WebUSB. School time is always Asia/Ho_Chi_Minh (UTC+7).
2. Choose a school window. Breaks are preferred; each window reserves five minutes
   for setup and three for packing. Add approved free periods and exclude holidays
   in **Adjust availability**. Settings stay on the device.
3. Attach the antenna and V3. **Check 96.5 FM** opens the browser's receiver chooser
   and plays mono audio for up to 60 seconds. Adjust volume if necessary.
4. At the pass, **Start receiving**. The page sets gain, sample rate, and Meteor
   channel selection automatically. Keep the tab visible and the computer awake.
5. Stop, choose a received channel, and **Save image + data**. The ZIP contains the
   unprojected grayscale PNG, corrected CADU frames, and JSON observation metadata
   with SHA-256 hashes. Missing image regions remain empty or black.

Windows may need a **one-time WinUSB driver setup for Bulk-In, Interface 0**:
[official RTL-SDR guide](https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/).
A webpage cannot install a Windows USB driver. On macOS, no separate driver is
normally needed. Close other SDR software before connecting. An antenna suitable
for Meteor's 137 MHz downlink is still required; audible FM alone does not establish
that the antenna is suitable for satellite reception.

## Validation status

- Production WASM recovers recorded CADU payloads from deterministic, generated
  noisy 72 ksymbol/s OQPSK waveforms at 288 kS/s with frequency offset and chirp.
  The final +2.5 kHz check recovers 159 of 160 frames, with **zero accepted payload
  mismatches** and identical results across irregular input block sizes. A prior
  −5 kHz stress run recovered 155 frames with zero payload mismatches.
- Independent native SatDump 1.2.2 also decodes the generated waveform. Recorded
  image pixels are compared with SatDump output in automated regression tests.
- FM testing recovers a synthesized 1 kHz audio tone with >99% of steady-state
  energy at the expected frequency and verifies USB chunk-boundary continuity.
- **Live RTL-SDR Blog V3 reception is not yet validated:** no dongle was connected.
  No real on-air IQ capture or complete live Meteor pass has been tested here.
  Generated IQ and a recorded-frame replay do not replace that field test.

Direct `file://` execution could not be browser-tested because the automation
browser blocks that URL scheme. Prefer the hosted URL for the first USB test.

This is a field-test build, not a claim of proven plug-and-play reception on every
personal Mac/Windows device. The decoder targets modern 72 ksymbol/s OQPSK/NRZ-M
Meteor LRPT. It does not implement the legacy 80 ksymbol/s interleaved mode.

## Development

Requirements: Node.js 22+, pnpm, and a current desktop browser. Application code is
feature-organized under `src/meteor_station/`. The thin Vercel adapter is `api/`.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test:coverage
pnpm build
```

`dist/meteor-station.html` embeds JavaScript, worker, WASM, fonts, Earth geometry,
the sample recording, and the saved orbit catalogue. Its radio and replay paths
work without downloading decoder assets. Fresh orbital elements require a network
connection or an imported JSON file. Download metadata and corresponding source
are written alongside the HTML. Do not redistribute only the binary HTML without
the source and license materials required by the included software/data licenses.

### Rebuild the DSP and repeat waveform validation

The generated WASM artifact is committed so ordinary hosting builds need no native
compiler. Rebuilding uses Emscripten **4.0.23** and the vendored pinned sources:

```sh
EMSDK=/path/to/emsdk node scripts/build-decoder.mjs
node scripts/build-fixture.mjs 2500   # clang / clang++ needed
node scripts/validate-decoder.mjs
```

`build/fixtures/meteor-test.cu8` is a **generated test waveform**, never an on-air
recording. Open it through **Recording files → Raw IQ · CU8 · 288 kS/s** to exercise
the production browser worker. The generator uses a fixed random seed; it writes
files only and never transmits RF. Validation JSON includes input hashes.

### Hosting

Deploy with `vercel --prod` after linking the intended team/project. The only backend
is `GET /api/orbits`: shared CDN caching plus in-process request coalescing/backoff
protects CelesTrak from student refresh traffic. It serves a dated snapshot if the
upstream is unavailable. Browser freshness depends on the **orbital epoch**, not
the fetch time: warnings after seven days, prediction disabled after fourteen.

Set `VITE_ORBIT_API` to the production `/api/orbits` URL at build time to let a
downloaded `file://` copy refresh directly. Without it, import exported orbit JSON.
The endpoint is public and contains no student data. No USB data is uploaded.

## Sources and constraints

- Bell times: [VAS lab booking Secondary reference](https://vas-lab-booking.netlify.app/).
  Only public bell times were used, not bookings. Campus: **Sunrise**, not Sala.
- Sunrise observer: 10.7385156 N, 106.6975343 E; assumed height 10 m.
  [Public campus listing](https://en.schoolisting.vn/viet-nam/quan-7/preschool_category/truong-quoc-te-viet-uc-vas-co-so-sunrise).
- [CelesTrak weather catalogue](https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=json).
  NORAD IDs: 57166 and 59051. Orbit visibility does not confirm transmitter activity.
- [Web RTL-SDR](https://github.com/jtarrio/webrtlsdr),
  [MeteorDemod](https://github.com/Digitelektro/MeteorDemod),
  [libcorrect](https://github.com/quiet/libcorrect),
  [satellite.js](https://github.com/shashwatak/satellite-js),
  [SatDump](https://github.com/SatDump/SatDump).
- Real recorded CADU fixture: raspberry-noaa-v2 verification tool. Its observation
  time and reception site are not known. Details in `tests/fixtures/metadata.json`.

See `THIRD_PARTY_NOTICES.txt`, `docs/decisions/`, and `docs/validation/` for licenses,
architecture, reproducibility, and acceptance evidence.

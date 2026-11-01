# Persistent reception sessions and honest outcomes

## Problem

A live reception with no decoded image had no export path. The image placeholder
contained a bundled sample button which looked like a way to process the capture.
Replaying that sample replaced the live in-memory state. Raw receiver samples were
not retained, so those previous attempts cannot be recovered retroactively.

## Workflow

Start live reception -> automatic raw recording and image decoding -> Stop ->
review the measured outcome -> Export session. A session remains useful even when
it contains no image, no decoded frames, or no receiver samples at all.

The capture panel separates input samples, decoded frames and image segments.
Spectrum power is not called satellite lock or proof of a Meteor transmission.
The live image remains on the main receiver page and appears automatically.
The bundled sample is in collapsed Diagnostics and is explicitly labelled
"Sample replay - not your reception". Sample and imported sessions have separate
identifiers and never overwrite a live session.

## Storage and export

Live CU8 samples are copied before the worker transfer and committed incrementally
to IndexedDB (`meteor.captures.v1`) in this browser, for this site. Decoded frames
are committed incrementally too, including partial progress before worker failure.
Each raw chunk and its metadata counters share one transaction. No radio data is
uploaded to a server.

Saved sessions can be reviewed, exported and explicitly deleted. Browser storage
is not a backup: clearing site data, eviction or changing browsers/origins may make
these sessions inaccessible. An unfinished entry after a reload is labelled as
unfinished or possibly active in another tab, not silently declared complete.

Every export has metadata.json and capture-log.json. It has received.cadu only if
frames were retained, and weather-image.png only if an image was recovered.
The raw-data option includes one CU8 file per tuning interval, with frequency,
sample rate and host receive timestamps. Different tuning intervals are not
concatenated as if they were one uninterrupted fixed-frequency recording.

Large archives stream to a chosen local file using the File System Access API.
The normal download fallback is limited to 128 MiB. Raw data remains in this browser
when a large export is unavailable; export without raw remains possible. Imported
files are read in bounded slices up to 768 MiB, not loaded whole into page memory.
The original imported file is not duplicated into local raw storage.

## Bounds and failures

At 288,000 complex samples/s, unsigned 8-bit I/Q uses 576,000 bytes/s:
about 33 MiB/minute or 330 MiB for ten minutes. The existing live limit is twenty
minutes. A session also has a 768 MiB raw limit and a 4 MiB pending-write limit.
On quota or write failure, stop, mark the recording incomplete and keep the
committed prefix; do not silently discard incoming data. The session records
observed, processed and saved counts separately. Export verifies stored byte
counts and aborts rather than reporting success with missing chunks.

## Verification

`pnpm check:capture` compiles the production capture core with the pinned compiler
and runs twelve deterministic regressions. It is included in the production build
alongside the existing Vitest suite and type/server checks. Storage in these tests
is an in-memory stand-in, not a claim of native IndexedDB validation.

Local Chromium interaction checks exercised the actual main entry point and
capture presenter with USB, decoder, planner and storage stand-ins: no-image and
no-input outcomes, export availability, sample isolation, history review and phone
layout. Stand-in base styling is not a production visual acceptance test.
Independent Python ZIP validation checked generated archive CRCs and raw payloads.

Physical V3 reception, large on-device disk recording, native IndexedDB persistence
across reload and a complete live Meteor pass remain field acceptance checks.

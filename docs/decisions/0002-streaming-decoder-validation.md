# ADR 0002: validate the streaming decoder against independent content

## Context

The V3 is not connected during development. A browser interface that draws a
sample image does not establish RF reception or demodulator correctness.

## Decision

Use pinned MeteorDemod DSP/FEC and libcorrect compiled with Emscripten 4.0.23.
Compile only the web/worker runtime loader. The self-contained production artifact
also runs under Node’s standard WebAssembly APIs for repeatable validation; no
Node-specific loader or external worker script is needed in the downloaded HTML.

The signal path is 288 kS/s CU8 → AGC → root-raised-cosine filtering → OQPSK Costas
carrier recovery → timing recovery → soft decisions → convolutional Viterbi →
NRZ-M → CCSDS descrambling → four interleaved RS(255,223) codewords → CADUs.
Image packet assembly and bounded JPEG segment reconstruction run in the worker.

Synthetic OQPSK carries payloads from an independently recorded public CADU file.
The fixed-seed waveform has Gaussian noise, a frequency offset, and a 20 Hz/s chirp.
The decoder must recover at least 120 of 160 generated frames, with no mismatched
accepted payloads or duplicate frame counters. Arbitrary input block boundaries
must produce identical recovered-frame hashes. Noise alone must yield no frames.
Separate image tests compare 2,784 pixel samples across three channels against
native SatDump 1.2.2, allowing two grayscale levels of JPEG rounding difference.

The original per-frame Viterbi initialization corrupted the first ASM byte: its
trellis and NRZ-M decoder lacked preceding state. The streaming adapter now keeps
128 real pre-roll soft samples, decodes them, and discards eight convergence bytes.
It does not overwrite or guess the ASM. The very first frame can be lost without
pre-roll. RS output parity is regenerated after correcting the 223 data bytes;
the original upstream implementation copied uninitialized parity bytes.

## Consequences

Recorded-frame and generated-signal validation are reproducible without hardware.
They do not establish RF sensitivity, WebUSB throughput, real oscillator error,
airborne transmitter mode, antenna quality, or real-pass success. Physical FM and
Meteor acceptance on macOS and Windows remains necessary before classroom rollout.
The 96.5 FM check establishes the radio/audio path only when audibly tested with
hardware; its automated test covers a generated FM tone and the tuning/lifecycle.

The browser queue is bounded and fails visibly rather than silently dropping IQ.
Sessions close USB, workers, wake locks, and audio; hiding the tab stops live
capture to avoid presenting an unknowably incomplete background recording.

# Changelog

All notable changes follow Keep a Changelog.

## [Unreleased]

### Added
- Sunrise campus Earth map with SGP4 positions, ground tracks, and pass previews.
- Secondary bell-time matching, break preference, setup/packing buffers, approved
  periods, holiday exclusions, and calendar export.
- One-button 96.5 MHz FM audio check for RTL-SDR Blog V3.
- WebUSB capture, bounded processing worker, browser Meteor OQPSK/FEC decoder,
  grayscale channel reconstruction, recorded replay, and observation ZIP exports.
- Standalone HTML with embedded decoder/assets and a cached Vercel orbit endpoint.
- Regression tests, independent SatDump image references, and waveform validation.

### Fixed
- Viterbi convergence and NRZ-M boundary state using real pre-roll samples.
- Reed–Solomon corrected parity output; incomplete final-buffer flushing.
- Receiver cancellation/cleanup races and school-local availability buffers.

### Pending acceptance
- Physical V3 connection, audible 96.5 FM reception, and a real Meteor pass on
  personal macOS and Windows computers.

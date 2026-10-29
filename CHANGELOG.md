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

- Receiver dashboard with Satellite/Radio modes, measured IQ spectrum and waterfall,
  audio waveform, tuned frequency, sample counts and elapsed time.
- Readable availability cards and a date picker with removable excluded days.

### Changed
- Simplified the interface with compact Material-style controls and concise copy.
- Added a default Sunrise regional map and a Global toggle, preserving pass previews.
- Live/preview tracking controls, visible refresh and a position timestamp.
- Warm neutral and deep teal palette with stronger text and map contrast.
- Moved reference times and orbit details into optional disclosures.
- Consolidated the stylesheet into one token set with shared button, segmented
  control, card and dialog patterns; map SVG and canvas instruments now read the
  same CSS tokens instead of hard-coded colors.
- Navigation uses underline tabs; map view, map time and receiver mode share one
  segmented control, and Refresh is a separate outlined action.
- Selected pass shows satellite, height, usable time and path as labelled facts.
- Availability lists the whole school day in bell order with breaks marked
  Included, has a fixed header and Save/Cancel bar, and the planner summarises the
  current availability.
- Receiver status sits under the primary action, with distinct idle, active,
  stopped and error presentation; radio-mode copy no longer repeats itself.
- Recordings without center-frequency metadata read “Not recorded” rather than
  a dash labelled “Unknown”.

### Fixed
- Map and instrument text no longer shrinks with the panel width: labels keep a
  fixed on-screen size, and the Sunrise view crops around the campus on narrow
  screens.
- Campus, satellite and region labels on the map no longer overlap; region labels
  give way to the campus and satellites.
- Spectrum, waterfall and audio canvases render at the device pixel ratio and
  redraw on resize.
- Selected segmented controls keep their selected appearance on hover, and focus
  rings remain visible on dark panels.
- Viterbi convergence and NRZ-M boundary state using real pre-roll samples.
- Reed–Solomon corrected parity output; incomplete final-buffer flushing.
- Receiver cancellation/cleanup races and school-local availability buffers.

### Pending acceptance
- Physical V3 connection, audible 96.5 FM reception, and a real Meteor pass on
  personal macOS and Windows computers.

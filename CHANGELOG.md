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
- “Any time (testing)” switch in Availability: greys out bell periods and lists
  every pass, day or night and at weekends, keeping setup/pack-away buffers and
  excluded days. Saved with the other availability settings.
- The planner states its rolling seven-day horizon and end date, and long lists
  show “Showing 12 of N windows” with Show all / Show fewer.

- Live satellite position on the Receive page: a sky plot of the selected pass with
  the satellite's current elevation, direction, Doppler shift at 137.9 MHz and
  countdowns to rise, peak and set, so students need not leave the page (hiding
  the tab stops reception).

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
- The Meteor decoder no longer stays blind after a noisy start to a pass. Its
  symbol-timing loop drifted up to ±1% while only noise arrived and could not
  recover when the satellite rose, so a 26 Nov 2026 capture decoded 0 frames
  although SatDump recovered 650. Timing is now limited to ±0.3% and restarts after
  20 s without frames; the same capture decodes 231 frames. Decoder validation
  adds a three-minute noise lead-in case.
- A pass already overhead, or rising within the 5-minute setup time, stays in the
  plan from now, marked "Now" with a set-up-now note, instead of disappearing.
  Predictions start 30 minutes back so an in-progress pass keeps its real rise
  time, peak and identity.
- Satellite reception no longer leaves a channel every 45 seconds while it shows
  an LRPT-shaped signal: it stays while the in-band power (3–25 kHz) is at least
  0.6 dB above the 70–100 kHz guard bands, and moves on 30 seconds after it fades.
  Narrow interference lines do not count. Tuned against a field capture where
  alternating channels split a 76° Meteor M2-4 pass in half.
- Corrected the pinned Web RTL-SDR dependency's low-rate calculation: the requested
  288 kS/s no longer reaches the FM and Meteor decoders as an incorrect 800 kS/s.
- Cancelling receiver startup cannot revive a stopped session or let delayed
  operations alter a replacement session.
- Image channel selection and export metadata now follow the displayed pixels,
  including after a new recording and while a channel change is pending.
- Adjacent available school periods share setup and pack-away buffers, allowing
  passes that cross bell boundaries while preserving unavailable gaps.
- Selected reception windows survive small rise-time changes during automatic
  planner recalculation.
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

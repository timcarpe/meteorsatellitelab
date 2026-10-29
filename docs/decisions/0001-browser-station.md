# ADR 0001: Run the receiver and decoder in the student's browser

Status: accepted for implementation; hardware acceptance pending.

## Context

Students use personal Mac or Windows computers with RTL-SDR Blog V3 hardware.
The requested experience is a downloadable HTML file or hosted page with no
student installation of a decoder or local companion service.

## Decision

Use TypeScript with a feature-based `src/meteor_station/` layout. A WebUSB
driver acquires unsigned 8-bit interleaved IQ. A dedicated worker runs a
focused, source-available Meteor demodulator and error-correcting decoder in
WebAssembly, then assembles MSU-MR image packets. Transfer buffers between
threads and bound all queues; a processing overrun must be visible.

Use satellite.js for SGP4 propagation and an Earth map bundled with the
application. Use the supplied Secondary timetable for bell times and Sunrise
campus for the observer. Prefer breaks, reserve setup/pack-away time, and
display conflicts explicitly. Do not infer a student's free periods from
lab room bookings.

Ship a static Vite application on Vercel and generate a single-file HTML
download from the same sources. Any hosted orbit-data endpoint only retrieves
and caches public orbital elements; RF samples and student images stay on
their device.

## Consequences

Chrome or Edge and a user-initiated USB permission grant are required for
reception. Windows can require a one-time WinUSB driver change. Safari and
Firefox can still show predictions. The tab must remain open and the computer
awake. Transmission availability is distinct from an orbit prediction.

The project has no Python application. Node's package.json and lockfile are
the executable build configuration; TypeScript strict checking and Vitest
provide the typing and test checks required by the repository guidelines.
Native decoder build scripts are outside the application package. Upstream
licenses, pinned revisions, fixtures, and validation evidence are retained.

Live V3 reception cannot be signed off until connected hardware and an actual
satellite pass are available. Recorded-data and generated-signal validation
will be labelled separately.

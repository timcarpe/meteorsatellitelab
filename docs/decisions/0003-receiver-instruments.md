# ADR 0003: Measured receiver instruments

## Context
Students need readable radio and satellite controls, an optional FM check and
useful visual feedback without false indications of reception.

## Decision
Use separate Satellite and Radio modes. The worker publishes at most ten spectrum
updates per second from actual CU8 IQ. Each spectrum averages up to four 512-point
Hann-windowed complex FFTs. Values are relative dBFS, never calibrated dBm.
The browser draws a bounded waterfall and the real demodulated FM audio envelope.
CADU image replay contains no IQ and does not produce a spectrum. Imported IQ
recordings have an unknown center frequency and display frequency offsets.
Retuning publishes the actual frequency returned by the USB device.

The planner defaults to current positions, with distinct Live and Pass preview
controls, a timestamp and an explicit refresh action. View changes preserve time.

## Consequences
Spectra and audio remain empty without samples; they do not simulate live radio.
FFT frequency sign and amplitude are covered by known-tone tests; automatic
retuning has a controller regression test. Canvas presentation is browser-tested
and excluded from business-logic unit coverage. Physical reception still needs
a V3 field test.

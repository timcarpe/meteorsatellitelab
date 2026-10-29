/* Streaming adapter for Digitelektro/MeteorDemod's MIT-licensed DSP chain. */
#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <memory>
#include "vendor/meteordemod/DSP/agc.h"
#include "vendor/meteordemod/DSP/filter.h"
#include "vendor/meteordemod/DSP/meteorcostas.h"
#include "vendor/meteordemod/DSP/mm.h"

namespace {
std::unique_ptr<DSP::Agc> agc;
std::unique_ptr<DSP::RRCFilter> rrc;
std::unique_ptr<DSP::MeteorCostas> costas;
std::unique_ptr<DSP::MM> timing;
float sample_rate = 0;
std::array<std::complex<float>, 8192> samples{};
}

extern "C" {
int radio_init(int rate) {
    if (agc || rate < 144000 || rate > 2400000) return -1;
    sample_rate = rate;
    agc = std::make_unique<DSP::Agc>(0.5f, 100.0f);
    rrc = std::make_unique<DSP::RRCFilter>(64, 0.6f, 72000.0f, sample_rate);
    const float deviation = 10000.0f * 2.0f * M_PI / sample_rate;
    costas = std::make_unique<DSP::MeteorCostas>(DSP::MeteorCostas::OQPSK,
        2.0f * M_PI * 100.0f / 72000.0f, 0, 0, -deviation, deviation);
    timing = std::make_unique<DSP::MM>(sample_rate / 72000.0f, 1e-6f, 0.01f, 0.01f);
    return 0;
}
float radio_carrier_offset() {
    return costas ? costas->getFrequency() * sample_rate / (2.0f * M_PI) : 0;
}
int radio_demod(const uint8_t *iq, int bytes, uint8_t *soft) {
    if (!agc || bytes < 0 || bytes % 2) return -1;
    int count = 0;
    for (int offset = 0; offset < bytes; offset += 8192 * 2) {
        const int size = std::min(8192, (bytes - offset) / 2);
        for (int i = 0; i < size; i++) {
            samples[i] = {(iq[offset + i * 2] - 127.5f) / 128,
                          (iq[offset + i * 2 + 1] - 127.5f) / 128};
        }
        agc->process(samples.data(), samples.data(), size);
        rrc->process(samples.data(), samples.data(), size);
        costas->process(samples.data(), samples.data(), size);
        timing->process(size, samples.data(), [&](std::complex<float> value) {
            soft[count++] = static_cast<uint8_t>(static_cast<int8_t>(
                std::clamp(value.imag() * 127.0f, -127.0f, 127.0f)));
            soft[count++] = static_cast<uint8_t>(static_cast<int8_t>(
                std::clamp(value.real() * 127.0f, -127.0f, 127.0f)));
        });
    }
    return count;
}
}

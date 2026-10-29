/* Bounded browser adapter. MeteorDemod and libcorrect licenses are in vendor/. */
#include <algorithm>
#include <array>
#include <cstdint>
#include <memory>
#include <vector>
#include "vendor/meteordemod/meteordecoder.h"

extern "C" {
#include "vendor/libcorrect/include/correct.h"
int radio_init(int sample_rate);
int radio_demod(const uint8_t *iq, int bytes, uint8_t *soft);
float radio_carrier_offset(void);
}

namespace {
constexpr size_t MAX_INPUT = 262144;
constexpr size_t MAX_FRAMES = 32;
constexpr size_t SOFT_FRAME = 16384;
std::unique_ptr<MeteorDecoder> decoder;
std::vector<uint8_t> pending;
std::array<uint8_t, MAX_INPUT> symbols{};
std::array<uint8_t, MAX_FRAMES * 1024> frames{};
int frame_count = 0;
bool overflow = false;
int last_symbols = 0;

int feed(const uint8_t *data, size_t length, bool finish = false) {
    if (!decoder || length > MAX_INPUT) return -1;
    frame_count = 0;
    if (length) pending.insert(pending.end(), data, data + length);
    if (pending.size() < SOFT_FRAME + 128 ||
        (!finish && pending.size() < 2 * SOFT_FRAME)) return 0;
    decoder->decode(pending.data(), pending.size(), [](const uint8_t *frame, size_t size) {
        if (size != 1024 || frame_count >= static_cast<int>(MAX_FRAMES)) {
            overflow = true;
            return;
        }
        std::copy(frame, frame + 1024, frames.begin() + frame_count++ * 1024);
    });
    // Keep one incomplete frame plus the 128-symbol Viterbi pre-roll.
    if (finish) pending.clear();
    else pending.erase(pending.begin(), pending.end() - (SOFT_FRAME + 127));
    return overflow ? -2 : frame_count;
}
}

extern "C" {
int station_init(int sample_rate) {
    if (decoder || radio_init(sample_rate) != 0) return -1;
    decoder = std::make_unique<MeteorDecoder>(false, true, true);
    pending.reserve(MAX_INPUT + SOFT_FRAME);
    return 0;
}
int station_iq(const uint8_t *data, int length) {
    if (length <= 0 || length > static_cast<int>(MAX_INPUT) || length % 2) return -1;
    const int count = radio_demod(data, length, symbols.data());
    last_symbols = count;
    return count < 0 ? count : feed(symbols.data(), count);
}
int station_soft(const uint8_t *data, int length) {
    if (length <= 0 || length > static_cast<int>(MAX_INPUT)) return -1;
    return feed(data, length);
}
const uint8_t *station_frames() { return frames.data(); }
int station_finish() { return feed(nullptr, 0, true); }
const uint8_t *station_symbols() { return symbols.data(); }
int station_symbol_count() { return last_symbols; }
float station_carrier_offset() { return radio_carrier_offset(); }
}

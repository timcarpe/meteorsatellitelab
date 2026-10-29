/* Offline test waveform generator. Writes files only; no radio transmission. */
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <random>
#include <vector>
extern "C" {
#include "correct.h"
}

double rrc(double time) {
    constexpr double alpha = 0.6;
    if (std::abs(time) < 1e-9) return 1 - alpha + 4 * alpha / M_PI;
    if (std::abs(std::abs(time) - 1 / (4 * alpha)) < 1e-9) {
        return alpha / std::sqrt(2) * ((1 + 2 / M_PI) * std::sin(M_PI / (4 * alpha))
             + (1 - 2 / M_PI) * std::cos(M_PI / (4 * alpha)));
    }
    return (std::sin(M_PI * time * (1 - alpha))
          + 4 * alpha * time * std::cos(M_PI * time * (1 + alpha)))
         / (M_PI * time * (1 - std::pow(4 * alpha * time, 2)));
}

int main(int argc, char **argv) {
    if (argc != 4) { std::cerr << "Usage: encode-fixture input.cadu output-prefix offset-hz\n"; return 1; }
    std::ifstream input(argv[1], std::ios::binary);
    if (!input) return 2;
    constexpr int frames = 160;
    std::vector<uint8_t> plain(frames * 1024);
    input.read(reinterpret_cast<char *>(plain.data()), plain.size());
    if (input.gcount() != static_cast<std::streamsize>(plain.size())) return 3;
    auto *rs = correct_reed_solomon_create(correct_rs_primitive_polynomial_ccsds,
                                         112, 11, 32);
    std::array<uint8_t, 223> lane{};
    std::array<uint8_t, 255> encoded_lane{};
    for (int f = 0; f < frames; f++) {
        auto *frame = plain.data() + f * 1024;
        for (int k = 0; k < 4; k++) {
            for (int i = 0; i < 223; i++) lane[i] = frame[4 + i * 4 + k];
            correct_reed_solomon_encode(rs, lane.data(), lane.size(), encoded_lane.data());
            for (int i = 0; i < 255; i++) frame[4 + i * 4 + k] = encoded_lane[i];
        }
        uint8_t reg = 0xff;
        for (int i = 4; i < 1024; i++) {
            uint8_t mask = 0;
            for (int b = 0; b < 8; b++) {
                mask = (mask << 1) | (reg & 1);
                reg = (reg >> 1) | (((reg ^ (reg >> 3) ^ (reg >> 5) ^ (reg >> 7)) & 1) << 7);
            }
            frame[i] ^= mask;
        }
    }
    correct_reed_solomon_destroy(rs);
    uint8_t previous = 0;
    for (auto &byte : plain) {
        uint8_t result = 0;
        for (int bit = 7; bit >= 0; bit--) {
            previous ^= (byte >> bit) & 1;
            result = (result << 1) | previous;
        }
        byte = result;
    }
    correct_convolutional_polynomial_t polynomials[] = {0x4f, 0x6d};
    auto *conv = correct_convolutional_create(2, 7, polynomials);
    const auto bits = correct_convolutional_encode_len(conv, plain.size());
    std::vector<uint8_t> encoded((bits + 7) / 8);
    correct_convolutional_encode(conv, plain.data(), plain.size(), encoded.data());
    correct_convolutional_destroy(conv);
    std::vector<int8_t> soft(bits);
    for (size_t n = 0; n < bits; n++) soft[n] = (encoded[n / 8] >> (7 - n % 8)) & 1 ? -96 : 96;
    std::ofstream softfile(std::string(argv[2]) + ".soft", std::ios::binary);
    softfile.write(reinterpret_cast<char *>(soft.data()), soft.size());
    constexpr int sps = 4, rate = 288000;
    std::array<std::array<double, 18>, sps> i_taps{}, q_taps{};
    for (int phase = 0; phase < sps; phase++) {
        for (int tap = 0; tap < 18; tap++) {
            const double t = phase / double(sps) - (tap - 8);
            i_taps[phase][tap] = rrc(t);
            q_taps[phase][tap] = rrc(t - 0.5);
        }
    }
    const size_t samples = (bits / 2 + 16) * sps;
    std::vector<uint8_t> iq(samples * 2);
    std::mt19937 random(917);
    std::normal_distribution<double> noise(0, 0.04);
    const double offset = std::stod(argv[3]);
    for (size_t n = 0; n < samples; n++) {
        double i = 0, q = 0;
        const int symbol = n / sps - 8;
        for (int tap = 0; tap < 18; tap++) {
            const int at = symbol + tap - 8;
            if (at < 0 || at * 2 + 1 >= static_cast<int>(soft.size())) continue;
            i += (soft[at * 2] / 96.0) * i_taps[n % sps][tap];
            q += (soft[at * 2 + 1] / 96.0) * q_taps[n % sps][tap];
        }
        const double t = n / double(rate);
        const double phase = 0.4 + 2 * M_PI * (offset * t + 10 * t * t);
        const double re = i * std::cos(phase) - q * std::sin(phase) + noise(random);
        const double im = i * std::sin(phase) + q * std::cos(phase) + noise(random);
        iq[2 * n] = std::clamp(int(std::round(127.5 + 55 * re)), 0, 255);
        iq[2 * n + 1] = std::clamp(int(std::round(127.5 + 55 * im)), 0, 255);
    }
    std::ofstream output(std::string(argv[2]) + ".cu8", std::ios::binary);
    output.write(reinterpret_cast<char *>(iq.data()), iq.size());
    std::cout << frames << " frames, " << samples / double(rate) << " seconds, "
              << rate << " samples/second, offset " << offset << " Hz\n";
}

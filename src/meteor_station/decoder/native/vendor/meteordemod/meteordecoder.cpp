#include "meteordecoder.h"

#include <iostream>

MeteorDecoder::MeteorDecoder(bool deInterleave, bool oqpsk, bool differentialDecode)
    : mDeInterleave(deInterleave)
    , mDifferentialDecode(differentialDecode)
    , mCorrelation(differentialDecode ? sSynchWordOQPSK : sSynchWordQPSK, oqpsk) {}

size_t MeteorDecoder::decode(uint8_t* softBits, size_t length, std::function<void(const uint8_t* cadu, std::size_t size)> callback) {
    size_t decodedPacketCounter = 0;
    size_t syncWordFound = 0;

    if(mDeInterleave) {
        std::cout << "Deinterleaving..." << std::endl;
        uint64_t outLen = 0;
        DeInterleaver::deInterleave(softBits, length, &outLen);
        length = outLen;
    }

    mCorrelation.correlate(softBits, length, [&softBits, length, &decodedPacketCounter, &syncWordFound, &callback, this](Correlation::CorellationResult correlationResult, Correlation::PhaseShift phaseShift) {
        bool packetOk;
        uint32_t processedBits = 0;

        do {
            syncWordFound++;

            if(length - (correlationResult.pos + processedBits) < 16384) {
                return processedBits;
            }

            // Viterbi needs preceding symbols to converge before the ASM.
            // NRZ-M also needs the preceding decoded bit. Do not synthesize it.
            const auto begin = correlationResult.pos + processedBits;
            if (begin < 128) return processedBits;
            std::copy(softBits + begin - 128, softBits + begin + 16384, mDataTodecode);

            mCorrelation.rotateSoftIqInPlace(mDataTodecode, 16512, phaseShift);

            uint8_t decoded[1032]{};
            mViterbi.decodeSoft(mDataTodecode, decoded, 16512);

            if(mDifferentialDecode) {
                differentialDecode(decoded, 1032);
            }

            std::copy(decoded + 8, decoded + 1032, mViterbiResult);
            if (mViterbiResult[0] != 0x1a || mViterbiResult[1] != 0xcf ||
                mViterbiResult[2] != 0xfc || mViterbiResult[3] != 0x1d)
                return processedBits;

            uint32_t last_sync_ = *reinterpret_cast<uint32_t*>(mViterbiResult);

            for(int j = 0; j < 1024 - 4; j++) {
                mViterbiResult[j + 4] = mViterbiResult[j + 4] ^ PRAND[j % 255];
            }

            if(mViterbiResult[9] == 0xFF) {
                for(int i = 0; i < 1024; i++) {
                    mViterbiResult[i] ^= 0xFF;
                }
            }

            for(int i = 0; i < 4; i++) {
                mReedSolomon.deinterleave(mViterbiResult + 4, i, 4);
                rsResult[i] = mReedSolomon.decode();
                mReedSolomon.interleave(mDecodedPacket + 4, i, 4);
            }

            // Browser adapter: report counters at the worker boundary.

            packetOk = (rsResult[0] != -1) && (rsResult[1] != -1) && (rsResult[2] != -1) && (rsResult[3] != -1);

            if(packetOk) {
                std::copy(mViterbiResult, mViterbiResult + 4, mDecodedPacket);
                callback(mDecodedPacket, sizeof(mDecodedPacket));
                decodedPacketCounter++;
                processedBits += 16384;
            }
        } while(packetOk);

        return (processedBits > 0) ? processedBits - 1 : 0;
    });



    return decodedPacketCounter;
}

void MeteorDecoder::differentialDecode(uint8_t* data, int64_t len) {
    uint8_t mask;
    uint8_t lastBit = 0;
    for(int i = 0; i < len; i++) {
        mask = ((data[i] >> 1) & 0x7F) | (lastBit << 7);
        lastBit = data[i] & 1;
        data[i] ^= mask;
    }
}
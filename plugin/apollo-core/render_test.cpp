// Renders the vertical-slice voice to float32 WAV files so the port can be
// verified spectrally against expectations (see verify.py):
//   slice_dark.wav   A2 saw, cutoff 0.35 — fundamental strong, highs rolled off
//   slice_bright.wav A2 saw, cutoff 0.90 — highs present
// Build:  clang++ -std=c++17 -O2 render_test.cpp -o render_test && ./render_test
#include "apollo_core.h"
#include <cstdio>
#include <cstring>
#include <string>

static void writeWavF32(const std::string& path, const std::vector<float>& samples, uint32_t sr) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) { std::perror("fopen"); return; }
  const uint32_t dataBytes = static_cast<uint32_t>(samples.size() * 4);
  const uint32_t riffSize = 36 + dataBytes;
  const uint16_t fmt = 3 /* IEEE float */, channels = 1, bits = 32;
  const uint32_t byteRate = sr * channels * bits / 8;
  const uint16_t blockAlign = channels * bits / 8;
  std::fwrite("RIFF", 1, 4, f); std::fwrite(&riffSize, 4, 1, f); std::fwrite("WAVE", 1, 4, f);
  std::fwrite("fmt ", 1, 4, f);
  const uint32_t fmtSize = 16;
  std::fwrite(&fmtSize, 4, 1, f); std::fwrite(&fmt, 2, 1, f); std::fwrite(&channels, 2, 1, f);
  std::fwrite(&sr, 4, 1, f); std::fwrite(&byteRate, 4, 1, f);
  std::fwrite(&blockAlign, 2, 1, f); std::fwrite(&bits, 2, 1, f);
  std::fwrite("data", 1, 4, f); std::fwrite(&dataBytes, 4, 1, f);
  std::fwrite(samples.data(), 4, samples.size(), f);
  std::fclose(f);
}

static std::vector<float> renderNote(double cutoff, uint32_t sr) {
  apollo::VoiceParams p;
  p.freqHz = 110.0;
  p.cutoff = cutoff;
  p.resonance = 0.2;
  apollo::Voice v;
  v.start(p, sr);
  const size_t noteSamples = sr * 3 / 2;       // 1.5 s held
  const size_t totalSamples = sr * 2;          // + 0.5 s tail
  std::vector<float> out;
  out.reserve(totalSamples);
  for (size_t i = 0; i < totalSamples; i++) {
    if (i == noteSamples) v.release();
    out.push_back(v.active() ? v.render() : 0.0f);
  }
  return out;
}

int main() {
  const uint32_t sr = 48000;
  writeWavF32("slice_dark.wav", renderNote(0.35, sr), sr);
  writeWavF32("slice_bright.wav", renderNote(0.90, sr), sr);
  std::printf("rendered slice_dark.wav + slice_bright.wav @ %u Hz\n", sr);
  return 0;
}

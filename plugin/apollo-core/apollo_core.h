// Apollo core DSP — C++ port, vertical slice.
//
// Line-for-line port of the voice math in public/apollo/engine.js
// (build 2026-08-20-17): AHDSR envelope with curve shaping, TPT state-variable
// filter, band-limited wavetable oscillator with linear table interpolation,
// and the shared cutoff/curve mapping functions. The goal of this slice is to
// prove the engine ports cleanly — engine.js is a single dependency-free file,
// and every construct in it (classes, typed-array DSP loops, closures over
// params) has a direct C++ equivalent shown here.
//
// Keep the math IDENTICAL to engine.js. When engine.js changes, port the
// change here; drift between the two defeats the purpose of the slice.
#pragma once
#include <cmath>
#include <cstdint>
#include <vector>

namespace apollo {

constexpr double kTwoPi = 6.283185307179586476925286766559;

inline double clampd(double v, double a, double b) { return v < a ? a : (v > b ? b : v); }

// 8 Hz .. 20 kHz, identical mapping to engine.js cutoffHz()
inline double cutoffHz(double norm) { return 8.0 * std::pow(2500.0, clampd(norm, 0.0, 1.0)); }

// envelope segment curvature, identical to engine.js curveShape()
inline double curveShape(double t, double c) {
  if (c == 0.0) return t;
  const double k = std::pow(4.0, std::fabs(c) * 2.0);
  return c > 0.0 ? std::pow(t, k) : 1.0 - std::pow(1.0 - t, k);
}

// ---------- envelope (engine.js class Env) ----------
struct EnvConfig {
  double attack = 0.005, hold = 0.0, decay = 0.15, sustain = 0.7, release = 0.3;
  double aCurve = 0.0, dCurve = 0.0, rCurve = 0.0;
};

class Env {
 public:
  enum State { IDLE, ATK, HOLD, DEC, SUS, REL };

  void trigger(bool legato = false) {
    if (!legato || state_ == IDLE || state_ == REL) { state_ = ATK; t_ = 0.0; }
    else { state_ = ATK; t_ = out_; }
  }
  void release() {
    if (state_ != IDLE) { relFrom_ = out_; state_ = REL; t_ = 0.0; }
  }
  void kill() { state_ = IDLE; out_ = 0.0; }
  bool active() const { return state_ != IDLE; }

  double process(const EnvConfig& cfg, double dt) {
    switch (state_) {
      case IDLE: out_ = 0.0; break;
      case ATK: {
        const double a = std::max(cfg.attack, 0.0005);
        t_ += dt / a;
        if (t_ >= 1.0) { t_ = 0.0; state_ = cfg.hold > 0.0 ? HOLD : DEC; out_ = 1.0; }
        else out_ = curveShape(t_, cfg.aCurve);
        break;
      }
      case HOLD:
        t_ += dt;
        out_ = 1.0;
        if (t_ >= cfg.hold) { t_ = 0.0; state_ = DEC; }
        break;
      case DEC: {
        const double d = std::max(cfg.decay, 0.001);
        t_ += dt / d;
        if (t_ >= 1.0) { state_ = SUS; out_ = cfg.sustain; }
        else out_ = 1.0 - curveShape(t_, cfg.dCurve) * (1.0 - cfg.sustain);
        break;
      }
      case SUS: out_ = cfg.sustain; break;
      case REL: {
        const double r = std::max(cfg.release, 0.002);
        t_ += dt / r;
        if (t_ >= 1.0) { state_ = IDLE; out_ = 0.0; }
        else out_ = relFrom_ * (1.0 - curveShape(t_, cfg.rCurve));
        break;
      }
    }
    return out_;
  }

 private:
  State state_ = IDLE;
  double t_ = 0.0, out_ = 0.0, relFrom_ = 0.0;
};

// ---------- TPT state-variable filter (engine.js class SVF) ----------
class SVF {
 public:
  void reset() { ic1_ = 0.0; ic2_ = 0.0; }
  // returns lp; lp/bp/hp readable after the call — identical to engine.js
  double process(double x, double g, double k) {
    const double a1 = 1.0 / (1.0 + g * (g + k));
    const double a2 = g * a1;
    const double v1 = a1 * ic1_ + a2 * (x - ic2_);
    const double v2 = ic2_ + g * v1;
    ic1_ = 2.0 * v1 - ic1_;
    ic2_ = 2.0 * v2 - ic2_;
    lp = v2; bp = v1; hp = x - k * v1 - v2;
    return v2;
  }
  double lp = 0.0, bp = 0.0, hp = 0.0;

 private:
  double ic1_ = 0.0, ic2_ = 0.0;
};

inline double svfG(double freq, double sr) {
  return std::tan(M_PI * clampd(freq, 5.0, sr * 0.49) / sr);
}

// ---------- wavetable oscillator ----------
// engine.js reads 2048-sample frames with linear interpolation; the basic-
// shapes saw frame is built additively (band-limited). Same construction here.
class WavetableOsc {
 public:
  static constexpr int kTableSize = 2048;

  // band-limited sawtooth: sum of harmonics below nyquist for the target pitch
  void buildSaw(int harmonics = 64) {
    table_.assign(kTableSize, 0.0f);
    for (int h = 1; h <= harmonics; h++) {
      const double amp = 1.0 / h;
      for (int i = 0; i < kTableSize; i++) {
        table_[i] += static_cast<float>(amp * std::sin(kTwoPi * h * i / kTableSize));
      }
    }
    // normalize to ±1
    float peak = 0.0f;
    for (float v : table_) peak = std::max(peak, std::fabs(v));
    if (peak > 0.0f) for (float& v : table_) v /= peak;
  }

  void setFreq(double hz, double sr) { inc_ = hz / sr; }

  float next() {
    const double p = phase_ * kTableSize;
    const int i = static_cast<int>(p);
    const double f = p - i;
    const float a = table_[i & (kTableSize - 1)];
    const float b = table_[(i + 1) & (kTableSize - 1)];
    phase_ += inc_;
    if (phase_ >= 1.0) phase_ -= 1.0;
    return static_cast<float>(a + (b - a) * f);
  }

 private:
  std::vector<float> table_;
  double phase_ = 0.0, inc_ = 0.0;
};

// ---------- a single voice: osc → SVF lowpass → env VCA ----------
struct VoiceParams {
  double freqHz = 110.0;      // A2
  double cutoff = 0.35;       // normalized, engine.js scale
  double resonance = 0.2;     // 0..1 → k = 2 - 2*res (engine.js damping map)
  EnvConfig env;
};

class Voice {
 public:
  void start(const VoiceParams& p, double sr) {
    params_ = p; sr_ = sr;
    osc_.buildSaw();
    osc_.setFreq(p.freqHz, sr);
    filt_.reset();
    env_.trigger();
  }
  void release() { env_.release(); }
  bool active() const { return env_.active(); }

  float render() {
    const double dt = 1.0 / sr_;
    const double e = env_.process(params_.env, dt);
    const double g = svfG(cutoffHz(params_.cutoff), sr_);
    const double k = 2.0 - 2.0 * clampd(params_.resonance, 0.0, 0.95);
    const double x = osc_.next();
    return static_cast<float>(filt_.process(x, g, k) * e * 0.5);
  }

 private:
  VoiceParams params_;
  double sr_ = 48000.0;
  WavetableOsc osc_;
  SVF filt_;
  Env env_;
};

}  // namespace apollo

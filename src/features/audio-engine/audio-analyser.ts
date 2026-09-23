/**
 * AudioAnalyser
 *
 * Implements real-time audio analysis using the Web Audio API AnalyserNode.
 * Computes root-mean-square (RMS) amplitude from time-domain waveform data
 * with zero-allocation persistent buffers, ambient noise auto-calibration,
 * configurable noise gating, and asymmetric attack/decay smoothing.
 */

export interface AudioAnalyserConfig {
  /** Baseline minimum RMS noise threshold (default 0.012) */
  noiseFloor: number;
  /** Noise gate offset above calibrated floor to suppress fan/room hum (default 0.006) */
  noiseGate: number;
  /** Calibration window duration in ms (default 1200) */
  calibrationDurationMs: number;
  /** Normalization ceiling for speech RMS amplitude (default 0.20) */
  maxExpectedRms: number;
  /** Fast attack coefficient for prompt speech onset reaction (default 0.35) */
  attackFactor: number;
  /** Gentle release decay coefficient for smooth decay when speech stops (default 0.075) */
  decayFactor: number;
  /** Perceptual exponent curve to expand quiet and normal speech (default 0.85) */
  powerCurve: number;
}

export const DEFAULT_ANALYSER_CONFIG: AudioAnalyserConfig = {
  noiseFloor: 0.012,
  noiseGate: 0.006,
  calibrationDurationMs: 1200,
  maxExpectedRms: 0.20,
  attackFactor: 0.35,
  decayFactor: 0.075,
  powerCurve: 0.85,
};

export class AudioAnalyser {
  private config: AudioAnalyserConfig;
  private floatBuffer: Float32Array | null = null;
  private byteBuffer: Uint8Array | null = null;
  private bufferSize: number = 0;
  private smoothedLevel: number = 0;
  private hasFloatMethod: boolean = true;

  // Auto-calibration state
  private calibrationStartTime: number | null = null;
  private calibrationSum: number = 0;
  private calibrationCount: number = 0;
  private isCalibrated: boolean = false;
  private calibratedNoiseFloor: number;

  constructor(config?: Partial<AudioAnalyserConfig>) {
    this.config = { ...DEFAULT_ANALYSER_CONFIG, ...config };
    this.calibratedNoiseFloor = this.config.noiseFloor;
  }

  /**
   * Resets ambient noise calibration so a new calibration window begins.
   */
  recalibrate(): void {
    this.calibrationStartTime = null;
    this.calibrationSum = 0;
    this.calibrationCount = 0;
    this.isCalibrated = false;
    this.calibratedNoiseFloor = this.config.noiseFloor;
  }

  /**
   * Samples the current audio frame from the given AnalyserNode,
   * performs ambient noise auto-calibration, applies noise gate,
   * and computes asymmetric attack/decay smoothed amplitude.
   *
   * @param analyser Web Audio API AnalyserNode
   * @param isMuted If true, forces target amplitude to 0 with natural decay
   * @returns Smoothed amplitude level normalized in [0.0, 1.0]
   */
  sample(analyser: AnalyserNode | null | undefined, isMuted: boolean = false): number {
    if (!analyser || isMuted) {
      // Natural prompt decay to 0 when muted or no analyser (~250ms)
      const muteDecay = Math.max(0.12, this.config.decayFactor * 1.6);
      this.smoothedLevel += (0 - this.smoothedLevel) * muteDecay;
      if (this.smoothedLevel < 0.005) {
        this.smoothedLevel = 0;
      }
      return this.smoothedLevel;
    }

    const fftSize = analyser.fftSize || 256;

    // Allocate persistent typed arrays once to guarantee 0 GC pressure in 60 FPS loop
    if (this.bufferSize !== fftSize) {
      this.bufferSize = fftSize;
      this.floatBuffer = new Float32Array(fftSize);
      this.byteBuffer = new Uint8Array(fftSize);
      this.hasFloatMethod = typeof analyser.getFloatTimeDomainData === 'function';
    }

    let sumSquares = 0;

    if (this.hasFloatMethod && this.floatBuffer) {
      analyser.getFloatTimeDomainData(this.floatBuffer as any);
      for (let i = 0; i < fftSize; i++) {
        const val = this.floatBuffer[i];
        sumSquares += val * val;
      }
    } else if (this.byteBuffer) {
      analyser.getByteTimeDomainData(this.byteBuffer as any);
      for (let i = 0; i < fftSize; i++) {
        const norm = (this.byteBuffer[i] - 128) / 128;
        sumSquares += norm * norm;
      }
    }

    const rms = Math.sqrt(sumSquares / fftSize);

    // ================= AMBIENT NOISE AUTO-CALIBRATION =================
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.calibrationStartTime === null) {
      this.calibrationStartTime = now;
    }

    if (!this.isCalibrated) {
      const elapsed = now - this.calibrationStartTime;
      this.calibrationSum += rms;
      this.calibrationCount++;
      const avg = this.calibrationSum / this.calibrationCount;

      // Bound noise floor to prevent speech during calibration from blocking audio
      this.calibratedNoiseFloor = Math.min(0.035, Math.max(this.config.noiseFloor, avg * 1.25));

      if (elapsed >= this.config.calibrationDurationMs) {
        this.isCalibrated = true;
      }
    }

    // ================= NOISE GATE & NORMALIZATION =================
    const gateThreshold = this.calibratedNoiseFloor + this.config.noiseGate;
    let target = 0;

    if (rms > gateThreshold) {
      const effectiveRms = rms - gateThreshold;
      const dynamicRange = Math.max(0.05, this.config.maxExpectedRms - this.calibratedNoiseFloor);
      const linearNorm = Math.min(1, effectiveRms / dynamicRange);
      target = Math.pow(linearNorm, this.config.powerCurve);
    }

    // ================= ASYMMETRIC SMOOTHING =================
    if (target > this.smoothedLevel) {
      // Fast attack
      this.smoothedLevel += (target - this.smoothedLevel) * this.config.attackFactor;
    } else {
      // Gentle decay
      this.smoothedLevel += (target - this.smoothedLevel) * this.config.decayFactor;
    }

    if (this.smoothedLevel < 0.001) {
      this.smoothedLevel = 0;
    }

    return this.smoothedLevel;
  }

  /**
   * Applies smoothing directly to an external numeric level value (0.0 to 1.0)
   */
  stepWithDirectLevel(targetLevel: number, isMuted: boolean = false): number {
    const target = isMuted ? 0 : Math.max(0, Math.min(1, targetLevel));
    if (target > this.smoothedLevel) {
      this.smoothedLevel += (target - this.smoothedLevel) * this.config.attackFactor;
    } else {
      this.smoothedLevel += (target - this.smoothedLevel) * this.config.decayFactor;
    }
    if (this.smoothedLevel < 0.001) {
      this.smoothedLevel = 0;
    }
    return this.smoothedLevel;
  }

  getSmoothedLevel(): number {
    return this.smoothedLevel;
  }

  getCalibratedNoiseFloor(): number {
    return this.calibratedNoiseFloor;
  }

  getIsCalibrated(): boolean {
    return this.isCalibrated;
  }

  reset(): void {
    this.smoothedLevel = 0;
  }
}

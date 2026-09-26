import { AudioAnalyser, DEFAULT_ANALYSER_CONFIG } from '../src/features/audio-engine/audio-analyser';
import { VoiceBlobGenerator, BLOB_POINT_COUNT } from '../src/features/audio-engine/voice-blob-generator';

// Mock AnalyserNode for testing
class MockAnalyserNode {
  fftSize = 256;
  waveform: Float32Array;

  constructor(waveform?: Float32Array) {
    this.waveform = waveform || new Float32Array(this.fftSize);
  }

  getFloatTimeDomainData(destination: Float32Array) {
    for (let i = 0; i < this.fftSize; i++) {
      destination[i] = this.waveform[i] || 0;
    }
  }

  setSineWave(amplitude: number, frequency: number = 440, sampleRate: number = 48000) {
    for (let i = 0; i < this.fftSize; i++) {
      this.waveform[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
  }

  setSilence() {
    this.waveform.fill(0);
  }
}

function runTests() {
  console.log('=== Testing AudioAnalyser and Telegram Voice Blob Calculation ===\n');

  const analyser = new AudioAnalyser();
  const mockNode = new MockAnalyserNode();

  // Test 1: Silence should return 0
  mockNode.setSilence();
  const silenceLevel = analyser.sample(mockNode as unknown as AnalyserNode, false);
  console.log(`[Test 1] Silence level: ${silenceLevel.toFixed(4)} (Expected: 0)`);
  if (silenceLevel !== 0) throw new Error('Silence should produce 0');

  // Test 2: Attack phase on quiet speech
  mockNode.setSineWave(0.08);
  const sample1 = analyser.sample(mockNode as unknown as AnalyserNode, false);
  const sample2 = analyser.sample(mockNode as unknown as AnalyserNode, false);
  const sample3 = analyser.sample(mockNode as unknown as AnalyserNode, false);
  console.log(`[Test 2] Quiet speech attack frames: ${sample1.toFixed(3)} -> ${sample2.toFixed(3)} -> ${sample3.toFixed(3)}`);
  if (sample1 <= 0 || sample2 <= sample1) {
    throw new Error('Attack phase should ramp up smoothly');
  }

  // Test 3: Normal / Loud speech produces higher amplitude
  mockNode.setSineWave(0.35); // Loud speech -> RMS ~ 0.25
  let loudLevel = 0;
  for (let i = 0; i < 15; i++) {
    loudLevel = analyser.sample(mockNode as unknown as AnalyserNode, false);
  }
  console.log(`[Test 3] Loud speech stabilized level: ${loudLevel.toFixed(3)} (Expected: ~0.8 - 1.0)`);
  if (loudLevel < 0.7) throw new Error('Loud speech should yield high normalized level');

  // Test 4: Decay phase when speech stops
  mockNode.setSilence();
  const decayLevels: number[] = [];
  for (let i = 0; i < 20; i++) {
    decayLevels.push(analyser.sample(mockNode as unknown as AnalyserNode, false));
  }
  console.log(`[Test 4] Decay frames after speech ceases:`);
  console.log(`  Start: ${loudLevel.toFixed(3)} -> 5f: ${decayLevels[4].toFixed(3)} -> 10f: ${decayLevels[9].toFixed(3)} -> 20f: ${decayLevels[19].toFixed(3)}`);
  if (decayLevels[4] >= loudLevel || decayLevels[19] >= decayLevels[4]) {
    throw new Error('Decay should decrease smoothly without snapping');
  }

  // Test 5: Muting forces smooth decay to 0 even if microphone has loud audio
  mockNode.setSineWave(0.4);
  const mutedSample = analyser.sample(mockNode as unknown as AnalyserNode, true);
  console.log(`[Test 5] Muted with audio present: level = ${mutedSample.toFixed(4)}`);
  for (let i = 0; i < 30; i++) {
    analyser.sample(mockNode as unknown as AnalyserNode, true);
  }
  const finalizedMute = analyser.getSmoothedLevel();
  console.log(`  After 30 muted frames: ${finalizedMute.toFixed(4)} (Expected: 0)`);
  if (finalizedMute !== 0) throw new Error('Muting must settle to 0');

  // Test 6: Ambient noise auto-calibration
  console.log(`[Test 6] Calibrated noise floor: ${analyser.getCalibratedNoiseFloor().toFixed(4)}`);
  if (analyser.getCalibratedNoiseFloor() <= 0) throw new Error('Calibrated noise floor must be > 0');

  // Test 7: VoiceBlobGenerator spline output validation
  console.log(`\n[Test 7] Testing VoiceBlobGenerator...`);
  const blobGen = new VoiceBlobGenerator();

  // 7a. Silent frame
  const [silentL1, silentL2, silentL3] = blobGen.generateLayers(0, 1.0, false, false);
  console.log(`  Silent Layer 1 opacity: ${silentL1.opacity.toFixed(2)}, Layer 2: ${silentL2.opacity.toFixed(2)}, Layer 3: ${silentL3.opacity.toFixed(2)}`);
  if (silentL1.opacity <= 0 || silentL2.opacity !== 0 || silentL3.opacity !== 0) {
    throw new Error('At silence, only Layer 1 should be visible with subtle resting presence');
  }
  if (!silentL1.pathData.startsWith('M ') || !silentL1.pathData.endsWith('Z')) {
    throw new Error('Spline path must be a valid closed SVG path starting with M and ending with Z');
  }

  // 7b. Normal speech frame
  const [speechL1, speechL2, speechL3] = blobGen.generateLayers(0.45, 1.5, false, false);
  console.log(`  Normal speech Layer 1 opacity: ${speechL1.opacity.toFixed(2)}, Layer 2: ${speechL2.opacity.toFixed(2)}, Layer 3: ${speechL3.opacity.toFixed(2)}`);
  if (speechL2.opacity <= 0) {
    throw new Error('Layer 2 must emerge during normal conversational speech');
  }
  if (speechL1.pathData === speechL2.pathData) {
    throw new Error('Layers must deform independently and NOT remain concentric');
  }

  // 7c. Loud speech frame
  const [loudL1, loudL2, loudL3] = blobGen.generateLayers(0.85, 2.0, false, false);
  console.log(`  Loud speech Layer 1 opacity: ${loudL1.opacity.toFixed(2)}, Layer 2: ${loudL2.opacity.toFixed(2)}, Layer 3: ${loudL3.opacity.toFixed(2)}`);
  if (loudL3.opacity <= 0) {
    throw new Error('Layer 3 aura must activate during loud speech');
  }

  // 7d. Muted frame
  const [mutedL1, mutedL2, mutedL3] = blobGen.generateLayers(0.85, 2.0, true, false);
  console.log(`  Muted Layer 1 opacity: ${mutedL1.opacity}, Layer 2: ${mutedL2.opacity}, Layer 3: ${mutedL3.opacity}`);
  if (mutedL1.opacity !== 0 || mutedL2.opacity !== 0 || mutedL3.opacity !== 0) {
    throw new Error('All blob layers must have 0 opacity when muted');
  }

  console.log('\nAll AudioAnalyser and VoiceBlobGenerator tests passed with 100% precision!\n');
}

runTests();

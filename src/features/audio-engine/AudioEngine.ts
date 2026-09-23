import {
  AudioDeviceInfo,
  AudioEngineConfig,
  AudioEngineStatus,
  AudioLevelData,
  AudioLevelListener,
  AudioPermissionStatus,
} from './types';

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  private engineStatus: AudioEngineStatus = 'uninitialized';
  private permissionStatus: AudioPermissionStatus = 'unknown';
  private selectedDeviceId: string = 'default';
  private isMuted: boolean = false;

  private meterInterval: number | null = null;
  private levelListeners: AudioLevelListener[] = [];
  private statusListeners: Array<(status: AudioEngineStatus) => void> = [];

  private config: AudioEngineConfig = {
    sampleRate: 48000,
    channelCount: 1, // Mono preferred for speech/Qur'an recitation
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    highpassFilterCutoff: 80, // 80 Hz cutoff for low-frequency handling noise
  };

  constructor(config?: Partial<AudioEngineConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  getStatus(): AudioEngineStatus {
    return this.engineStatus;
  }

  getPermissionStatus(): AudioPermissionStatus {
    return this.permissionStatus;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  addStatusListener(listener: (status: AudioEngineStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  addLevelListener(listener: AudioLevelListener): () => void {
    this.levelListeners.push(listener);
    return () => {
      this.levelListeners = this.levelListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: AudioEngineStatus) {
    this.engineStatus = status;
    this.statusListeners.forEach((l) => l(status));
  }

  /**
   * Check microphone permission status
   */
  async checkPermission(): Promise<AudioPermissionStatus> {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        // TypeScript standard DOM types may consider 'microphone' name as PermissionName
        const permissionDesc = { name: 'microphone' as PermissionName };
        const status = await navigator.permissions.query(permissionDesc);
        if (status.state === 'granted') {
          this.permissionStatus = 'granted';
        } else if (status.state === 'denied') {
          this.permissionStatus = 'denied';
        } else {
          this.permissionStatus = 'unknown';
        }
        return this.permissionStatus;
      }
    } catch {
      // permissions.query may not support microphone on all platforms/WebViews
    }
    return this.permissionStatus;
  }

  /**
   * Initialize AudioContext and stable routing graph
   */
  private ensureAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Note: do not enforce fixed sampleRate if platform prefers its own (F4 Section 8)
      this.audioContext = new AudioCtx();

      // Create stable processing nodes
      this.highpassFilter = this.audioContext.createBiquadFilter();
      this.highpassFilter.type = 'highpass';
      this.highpassFilter.frequency.setValueAtTime(
        this.config.highpassFilterCutoff || 80,
        this.audioContext.currentTime
      );

      this.compressorNode = this.audioContext.createDynamicsCompressor();
      this.compressorNode.threshold.setValueAtTime(-24, this.audioContext.currentTime);
      this.compressorNode.knee.setValueAtTime(30, this.audioContext.currentTime);
      this.compressorNode.ratio.setValueAtTime(4, this.audioContext.currentTime);
      this.compressorNode.attack.setValueAtTime(0.003, this.audioContext.currentTime);
      this.compressorNode.release.setValueAtTime(0.25, this.audioContext.currentTime);

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : 1, this.audioContext.currentTime);

      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.5;

      // Create stable destination node
      this.destinationNode = this.audioContext.createMediaStreamDestination();

      // Connect processing chain:
      // Source -> Highpass -> Compressor -> Gain (Mute) -> Analyser -> Destination
      this.highpassFilter.connect(this.compressorNode);
      this.compressorNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.destinationNode);

      this.startMeterLoop();
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((err) => {
        console.warn('[AudioEngine] Could not resume audio context:', err);
      });
    }

    return this.audioContext;
  }

  /**
   * Request microphone stream and attach to the stable audio graph
   */
  async startCapture(deviceId?: string): Promise<MediaStream> {
    // If already capturing and deviceId is unchanged, reuse current stream
    if (this.mediaStream && this.engineStatus === 'capturing' && (!deviceId || deviceId === this.selectedDeviceId)) {
      return this.getBroadcastStream();
    }

    this.setStatus('requesting_permission');
    const ctx = this.ensureAudioContext();

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        console.log('[AudioEngine] AudioContext successfully resumed in running state');
      } catch (resumeErr) {
        console.warn('[AudioEngine] AudioContext resume failed:', resumeErr);
      }
    }

    if (deviceId) {
      this.selectedDeviceId = deviceId;
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: this.selectedDeviceId !== 'default' ? { exact: this.selectedDeviceId } : undefined,
        channelCount: this.config.channelCount,
        echoCancellation: this.config.echoCancellation,
        noiseSuppression: this.config.noiseSuppression,
        autoGainControl: this.config.autoGainControl,
      },
      video: false,
    };

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported on this browser/origin (requires HTTPS or localhost)');
      }

      // Disconnect previous source if any
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaStream = stream;
      this.permissionStatus = 'granted';

      // Ensure tracks are enabled
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !this.isMuted;
      });

      // Attach new source to stable filter and analyser for UI audio ring meter
      this.sourceNode = ctx.createMediaStreamSource(stream);
      if (this.highpassFilter) {
        this.sourceNode.connect(this.highpassFilter);
      }
      if (this.gainNode) {
        this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : 1, ctx.currentTime);
      }

      this.setStatus(this.isMuted ? 'muted' : 'capturing');
      return this.getBroadcastStream();
    } catch (err: unknown) {
      console.warn('[AudioEngine] Microphone hardware unavailable or blocked, using resilient fallback audio track:', err);
      const error = err as { name?: string; message?: string };
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.permissionStatus = 'denied';
      } else {
        this.permissionStatus = 'error';
      }
      this.setStatus('muted');

      // Ensure destinationNode has an active audio track even if physical mic was unavailable
      try {
        const osc = ctx.createOscillator();
        const silentGain = ctx.createGain();
        silentGain.gain.setValueAtTime(0, ctx.currentTime);
        osc.connect(silentGain);
        if (this.destinationNode) {
          silentGain.connect(this.destinationNode);
        }
        osc.start();
      } catch (fallbackErr) {
        console.warn('[AudioEngine] Silent track fallback notice:', fallbackErr);
      }

      return this.getDestinationStream();
    }
  }

  /**
   * Returns the primary stream to broadcast over WebRTC
   * Uses real hardware MediaStreamTrack if available for native Opus encoding & zero latency
   */
  getBroadcastStream(): MediaStream {
    if (this.mediaStream && this.mediaStream.getAudioTracks().length > 0) {
      return this.mediaStream;
    }
    return this.getDestinationStream();
  }

  /**
   * Switch input microphone device seamlessly without breaking destination node
   */
  async switchDevice(deviceId: string): Promise<void> {
    if (this.selectedDeviceId === deviceId) return;
    this.selectedDeviceId = deviceId;

    if (this.engineStatus === 'capturing' || this.engineStatus === 'muted') {
      await this.startCapture(deviceId);
    }
  }

  /**
   * Get list of connected audio input devices
   */
  async enumerateDevices(): Promise<AudioDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
          groupId: d.groupId,
          isDefault: d.deviceId === 'default',
        }));
    } catch (err) {
      console.warn('[AudioEngine] Device enumeration failed:', err);
      return [];
    }
  }

  /**
   * Returns the stable MediaStream from MediaStreamAudioDestinationNode
   * Used as the invariant source for MediaRecorder and WebRTC RTCPeerConnection
   */
  getDestinationStream(): MediaStream {
    this.ensureAudioContext();
    if (!this.destinationNode) {
      throw new Error('[AudioEngine] Destination node is not initialized');
    }
    return this.destinationNode.stream;
  }

  /**
   * Mute / Unmute local microphone
   * Controls GainNode and Track enabled state without destroying session
   */
  setMute(mute: boolean) {
    this.isMuted = mute;
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setValueAtTime(mute ? 0 : 1, this.audioContext.currentTime);
    }

    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !mute;
      });
    }

    if (this.destinationNode?.stream) {
      this.destinationNode.stream.getAudioTracks().forEach((track) => {
        track.enabled = !mute;
      });
    }

    if (this.engineStatus === 'capturing' || this.engineStatus === 'muted') {
      this.setStatus(mute ? 'muted' : 'capturing');
    }
  }

  toggleMute(): boolean {
    this.setMute(!this.isMuted);
    return this.isMuted;
  }

  /**
   * Throttled meter loop (10-15 Hz) to notify UI of voice activity
   */
  private startMeterLoop() {
    if (this.meterInterval) return;

    const dataArray = new Uint8Array(128);
    // Interval of 80ms ~ 12.5 FPS: lightweight for battery & CPU
    this.meterInterval = window.setInterval(() => {
      if (!this.analyserNode || this.isMuted || this.engineStatus !== 'capturing') {
        if (this.levelListeners.length > 0) {
          const zero: AudioLevelData = { rms: 0, peak: 0, isSpeaking: false };
          this.levelListeners.forEach((l) => l(zero));
        }
        return;
      }

      this.analyserNode.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      let peak = 0;

      for (let i = 0; i < dataArray.length; i++) {
        // Centered around 128
        const norm = (dataArray[i] - 128) / 128;
        const abs = Math.abs(norm);
        if (abs > peak) peak = abs;
        sumSquares += norm * norm;
      }

      const rms = Math.sqrt(sumSquares / dataArray.length);
      const isSpeaking = rms > 0.03;

      const levelData: AudioLevelData = { rms, peak, isSpeaking };
      this.levelListeners.forEach((l) => l(levelData));
    }, 80);
  }

  private stopMeterLoop() {
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
  }

  /**
   * Clean up all audio resources
   */
  dispose() {
    this.stopMeterLoop();
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.setStatus('uninitialized');
  }
}

export const audioEngine = new AudioEngine();

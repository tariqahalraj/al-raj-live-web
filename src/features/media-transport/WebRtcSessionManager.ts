import {
  CloudflareTrack,
  MediaStatsListener,
  MediaTransportStats,
  TransportStatus,
  TransportStatusListener,
} from './types';
import { cloudflareApiAdapter } from './CloudflareApiAdapter';
import { negotiationController } from './NegotiationController';

export class WebRtcSessionManager {
  private peerConnection: RTCPeerConnection | null = null;
  private cloudflareSessionId: string | null = null;
  private publishedTrack: CloudflareTrack | null = null;
  private currentGeneration: number = 1;
  private status: TransportStatus = 'idle';

  private statusListeners: TransportStatusListener[] = [];
  private statsListeners: MediaStatsListener[] = [];
  private playStateListeners: Array<(isPlaying: boolean) => void> = [];
  private isAudioPlaying: boolean = false;
  private isPlayingAudio: boolean = false;
  private statsInterval: number | null = null;
  private lastBytesSent: number = 0;
  private lastBytesReceived: number = 0;
  private lastStatsTime: number = 0;

  private mountedAudioElement: HTMLAudioElement | null = null;
  private currentRemoteStream: MediaStream | null = null;
  private volume: number = 1.0;

  getVolume(): number {
    return this.volume;
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    const audioElement = this.mountedAudioElement || (document.getElementById('remote-audio-element') as HTMLAudioElement);
    if (audioElement) {
      audioElement.volume = this.volume;
      audioElement.muted = this.volume === 0;
    }
  }

  getGeneration(): number {
    return this.currentGeneration;
  }

  setGeneration(gen: number) {
    this.currentGeneration = gen;
    negotiationController.setGeneration(gen);
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  getIsAudioPlaying(): boolean {
    return this.isAudioPlaying;
  }

  private remoteAudioContext: AudioContext | null = null;
  private remoteSourceNode: MediaStreamAudioSourceNode | null = null;
  private remoteAnalyserNode: AnalyserNode | null = null;
  private connectedStreamId: string | null = null;

  getRemoteStream(): MediaStream | null {
    return this.currentRemoteStream;
  }

  getRemoteAudioContext(): AudioContext | null {
    return this.remoteAudioContext;
  }

  getRemoteAnalyserNode(): AnalyserNode | null {
    if (!this.currentRemoteStream || this.currentRemoteStream.getAudioTracks().length === 0) {
      return null;
    }
    try {
      if (!this.remoteAudioContext || this.remoteAudioContext.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.remoteAudioContext = new AudioCtx();
      }
      if (this.remoteAudioContext.state === 'suspended') {
        this.remoteAudioContext.resume().catch(() => {});
      }
      if (!this.remoteAnalyserNode) {
        this.remoteAnalyserNode = this.remoteAudioContext.createAnalyser();
        this.remoteAnalyserNode.fftSize = 256;
        this.remoteAnalyserNode.smoothingTimeConstant = 0.4;
      }
      
      const streamId = this.currentRemoteStream.id;
      if (this.connectedStreamId !== streamId || !this.remoteSourceNode) {
        if (this.remoteSourceNode) {
          try { this.remoteSourceNode.disconnect(); } catch {}
          this.remoteSourceNode = null;
        }
        this.connectedStreamId = streamId;
        this.remoteSourceNode = this.remoteAudioContext.createMediaStreamSource(this.currentRemoteStream);
        this.remoteSourceNode.connect(this.remoteAnalyserNode);
        try {
          const silentGain = this.remoteAudioContext.createGain();
          silentGain.gain.value = 0;
          this.remoteAnalyserNode.connect(silentGain);
          silentGain.connect(this.remoteAudioContext.destination);
        } catch {}
      }
      return this.remoteAnalyserNode;
    } catch (e) {
      console.warn('[WebRtcSessionManager] getRemoteAnalyserNode notice:', e);
      return null;
    }
  }

  getCloudflareSessionId(): string | null {
    return this.cloudflareSessionId;
  }

  getPublishedTrack(): CloudflareTrack | null {
    return this.publishedTrack;
  }

  setMute(muted: boolean) {
    if (this.peerConnection) {
      this.peerConnection.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !muted;
          console.log(`[WebRtcSessionManager] WebRTC sender track enabled = ${!muted}`);
        }
      });
    }
  }

  addPlayStateListener(listener: (isPlaying: boolean) => void): () => void {
    this.playStateListeners.push(listener);
    listener(this.isAudioPlaying);
    return () => {
      this.playStateListeners = this.playStateListeners.filter((l) => l !== listener);
    };
  }

  private notifyPlayState(playing: boolean) {
    if (this.isAudioPlaying === playing) return;
    this.isAudioPlaying = playing;
    this.playStateListeners.forEach((l) => l(playing));
  }

  addStatusListener(listener: TransportStatusListener): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  addStatsListener(listener: MediaStatsListener): () => void {
    this.statsListeners.push(listener);
    return () => {
      this.statsListeners = this.statsListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: TransportStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  /**
   * Prime/unlock audio playback within a direct user interaction context (tap/click)
   */
  unlockAudio() {
    const audioElement = this.mountedAudioElement || (document.getElementById('remote-audio-element') as HTMLAudioElement);
    if (audioElement) {
      audioElement.muted = false;
      audioElement.play().catch(() => {});
    }
    if (this.remoteAudioContext && this.remoteAudioContext.state === 'suspended') {
      this.remoteAudioContext.resume().catch(() => {});
    }
  }

  /**
   * Play remote audio stream on mounted element
   */
  async playRemoteAudio(): Promise<boolean> {
    const audioElement = this.mountedAudioElement || (document.getElementById('remote-audio-element') as HTMLAudioElement);
    if (!audioElement || !this.currentRemoteStream) {
      return false;
    }

    // If audio is already actively playing the current stream, no need to re-trigger
    if (!audioElement.paused && audioElement.srcObject === this.currentRemoteStream && this.isAudioPlaying) {
      return true;
    }

    // Prevent concurrent overlapping playback attempts
    if (this.isPlayingAudio) {
      return false;
    }
    this.isPlayingAudio = true;

    try {
      if (audioElement.srcObject !== this.currentRemoteStream) {
        audioElement.srcObject = this.currentRemoteStream;
      }
      audioElement.volume = this.volume;
      audioElement.muted = this.volume === 0;

      try {
        await audioElement.play();
        console.log('[WebRtcSessionManager] Remote audio playback active!');
        if (this.remoteAudioContext && this.remoteAudioContext.state === 'suspended') {
          this.remoteAudioContext.resume().catch(() => {});
        }
        this.notifyPlayState(true);
        return true;
      } catch (err) {
        console.warn('[WebRtcSessionManager] Autoplay prevented, attempting muted unlock:', err);
        // Fallback: start muted then unmute immediately to bypass browser autoplay restrictions
        try {
          audioElement.muted = true;
          await audioElement.play();
          audioElement.muted = this.volume === 0;
          console.log('[WebRtcSessionManager] Autoplay successfully unblocked!');
          this.notifyPlayState(true);
          return true;
        } catch {
          this.notifyPlayState(false);
          return false;
        }
      }
    } finally {
      this.isPlayingAudio = false;
    }
  }

  /**
   * Bind the real DOM mounted HTMLAudioElement for listener playback
   */
  attachAudioElement(element: HTMLAudioElement | null) {
    this.mountedAudioElement = element;
    console.log('[WebRtcSessionManager] Attached mounted HTMLAudioElement');
    if (element && this.currentRemoteStream) {
      this.playRemoteAudio();
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    const config: RTCConfiguration = {
      iceServers: [
        {
          urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'],
        },
      ],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };

    const pc = new RTCPeerConnection(config);

    pc.onconnectionstatechange = () => {
      console.log(`[WebRtcSessionManager] ConnectionState: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this.setStatus('connected');
      } else if (pc.connectionState === 'connecting') {
        this.setStatus('connecting');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.setStatus('recovery_required');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRtcSessionManager] ICEState: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        this.setStatus('recovery_required');
      }
    };

    return pc;
  }

  /**
   * Host Publishing: Publishes local audio track from AudioEngine to Cloudflare Realtime SFU
   */
  async publishHostAudio(
    appSessionId: string,
    localStream: MediaStream,
    generation: number = 1
  ): Promise<CloudflareTrack> {
    this.setGeneration(generation);
    this.setStatus('creating');

    return negotiationController.enqueueNegotiation(generation, async () => {
      this.teardown();

      const pc = this.createPeerConnection();
      this.peerConnection = pc;

      // Attach audio track
      const audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('[WebRtcSessionManager] No audio track found in local stream');
      }

      const sender = pc.addTrack(audioTrack, localStream);

      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });

      await pc.setLocalDescription(offer);

      // Bounded ICE gathering (1.5-2.0s)
      await negotiationController.gatherIce(pc);

      const localDesc = pc.localDescription;
      if (!localDesc) {
        throw new Error('[WebRtcSessionManager] Missing local description after ICE gathering');
      }

      const mid = negotiationController.extractAudioMid(localDesc.sdp);
      const trackName = `tariqah-host-${appSessionId}-${Date.now()}`;

      // Create Cloudflare session if not present
      const cfSessionId = await cloudflareApiAdapter.createSession();
      this.cloudflareSessionId = cfSessionId;

      // Publish track through privileged backend Edge Function
      const trackResponse = await cloudflareApiAdapter.publishTrack(
        cfSessionId,
        localDesc,
        mid,
        trackName,
        appSessionId
      );

      // Set remote answer
      await pc.setRemoteDescription(new RTCSessionDescription(trackResponse.sessionDescription));

      // Apply 24 kbps target ceiling to sender parameters
      await negotiationController.applySenderBitrateLimit(sender, 24000);

      this.publishedTrack = trackResponse.tracks[0];
      this.startStatsLoop();
      this.setStatus('connected');

      return this.publishedTrack;
    });
  }

  /**
   * Listener Subscription: Subscribes to host audio track from Cloudflare Realtime SFU
   */
  async subscribeHostAudio(
    _appSessionId: string,
    hostCfSessionId: string,
    hostCfTrackId: string,
    generation: number = 1
  ): Promise<void> {
    this.setGeneration(generation);
    this.setStatus('creating');

    return negotiationController.enqueueNegotiation(generation, async () => {
      this.teardown();
      this.setStatus('creating');

      const pc = this.createPeerConnection();
      this.peerConnection = pc;

      // Create receiver transceiver
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Handle incoming remote track
      pc.ontrack = (event: RTCTrackEvent) => {
        console.log('[WebRtcSessionManager] Received remote audio track:', event.track.id);
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        this.currentRemoteStream = remoteStream;

        // Immediately trigger playback through active audio pipeline
        this.playRemoteAudio().catch(console.warn);

        event.track.onunmute = () => {
          console.log('[WebRtcSessionManager] Remote track unmuted, playing remote audio');
          this.playRemoteAudio().catch(console.warn);
        };
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Bounded ICE gathering
      await negotiationController.gatherIce(pc);

      const localDesc = pc.localDescription;
      if (!localDesc) {
        throw new Error('[WebRtcSessionManager] Missing local description after ICE gathering');
      }

      // Create listener Cloudflare session
      const cfSessionId = await cloudflareApiAdapter.createSession();
      this.cloudflareSessionId = cfSessionId;

      // Subscribe to host track via backend Edge Function
      const trackResponse = await cloudflareApiAdapter.subscribeTrack(
        cfSessionId,
        localDesc,
        hostCfSessionId,
        hostCfTrackId
      );

      // Set remote answer
      await pc.setRemoteDescription(new RTCSessionDescription(trackResponse.sessionDescription));

      this.startStatsLoop();
      this.setStatus('connecting');
    });
  }

  /**
   * Monitor WebRTC transport statistics (Bitrate, packet loss, RTT, jitter)
   */
  private startStatsLoop() {
    if (this.statsInterval) return;

    this.lastStatsTime = Date.now();
    this.lastBytesSent = 0;
    this.lastBytesReceived = 0;

    this.statsInterval = window.setInterval(async () => {
      if (!this.peerConnection || this.peerConnection.connectionState === 'closed') {
        return;
      }
      if (this.statsListeners.length === 0) {
        return;
      }

      try {
        const stats = await this.peerConnection.getStats();
        const now = Date.now();
        const timeDiffSec = (now - this.lastStatsTime) / 1000;
        this.lastStatsTime = now;

        let bitrateKbps = 24; // Default baseline
        let packetLossPercent = 0;
        let rttMs = 35;
        let jitterMs = 2;

        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'audio') {
            const bytes = report.bytesSent || 0;
            if (timeDiffSec > 0 && this.lastBytesSent > 0) {
              bitrateKbps = Math.round(((bytes - this.lastBytesSent) * 8) / (timeDiffSec * 1000));
            }
            this.lastBytesSent = bytes;
          }

          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            const bytes = report.bytesReceived || 0;
            if (timeDiffSec > 0 && this.lastBytesReceived > 0) {
              bitrateKbps = Math.round(((bytes - this.lastBytesReceived) * 8) / (timeDiffSec * 1000));
            }
            this.lastBytesReceived = bytes;
            jitterMs = Math.round((report.jitter || 0) * 1000);

            const lost = report.packetsLost || 0;
            const received = report.packetsReceived || 1;
            packetLossPercent = Math.min(100, Math.round((lost / (lost + received)) * 100));
          }

          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rttMs = Math.round((report.currentRoundTripTime || 0.035) * 1000);
          }
        });

        const transportStats: MediaTransportStats = {
          bitrateKbps: Math.max(8, Math.min(64, bitrateKbps || 24)),
          packetLossPercent,
          roundTripTimeMs: rttMs,
          jitterMs,
          audioLevel: 1.0,
          timestamp: now,
        };

        this.statsListeners.forEach((l) => l(transportStats));
      } catch (err) {
        console.warn('[WebRtcSessionManager] Stats collection error:', err);
      }
    }, 2000);
  }

  private stopStatsLoop() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * Tear down PeerConnection, Cloudflare session and stats loop
   */
  teardown() {
    this.stopStatsLoop();
    negotiationController.reset();

    if (this.peerConnection) {
      try {
        this.peerConnection.getSenders().forEach((s) => {
          if (s.track) s.track.stop();
        });
        this.peerConnection.getReceivers().forEach((r) => {
          if (r.track) r.track.stop();
        });
        this.peerConnection.close();
      } catch (err) {
        console.warn('[WebRtcSessionManager] Error closing peer connection:', err);
      }
      this.peerConnection = null;
    }

    if (this.currentRemoteStream) {
      this.currentRemoteStream.getTracks().forEach((t) => t.stop());
      this.currentRemoteStream = null;
    }

    if (this.remoteSourceNode) {
      try { this.remoteSourceNode.disconnect(); } catch {}
      this.remoteSourceNode = null;
    }
    if (this.remoteAudioContext && this.remoteAudioContext.state !== 'closed') {
      try { this.remoteAudioContext.close(); } catch {}
      this.remoteAudioContext = null;
    }
    this.remoteAnalyserNode = null;

    if (this.mountedAudioElement) {
      try {
        this.mountedAudioElement.pause();
      } catch {}
      this.mountedAudioElement.srcObject = null;
    }

    this.cloudflareSessionId = null;
    this.publishedTrack = null;
    this.isPlayingAudio = false;
    this.notifyPlayState(false);
    this.setStatus('closed');
  }
}

export const webRtcSessionManager = new WebRtcSessionManager();

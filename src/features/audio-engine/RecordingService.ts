import { RecordingChunkMetadata, RecordingSessionManifest, RecordingStatus } from './types';
import { recordingStorage } from './RecordingStorage';

export class RecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private currentSessionId: string | null = null;
  private chunkIndex: number = 0;
  private startTime: number = 0;
  private lastChunkTime: number = 0;
  private status: RecordingStatus = 'idle';
  private statusListeners: Array<(status: RecordingStatus) => void> = [];

  getStatus(): RecordingStatus {
    return this.status;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  addStatusListener(listener: (status: RecordingStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: RecordingStatus) {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  /**
   * Start recording from a stable MediaStream (from AudioEngine's MediaStreamAudioDestinationNode)
   */
  startRecording(destinationStream: MediaStream, sessionId: string): boolean {
    if (this.status === 'recording') {
      console.warn('[RecordingService] Already recording');
      return false;
    }

    try {
      // Determine best supported container format
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus';
        } else {
          mimeType = ''; // Let browser choose default
        }
      }

      this.currentSessionId = sessionId;
      this.chunkIndex = 0;
      this.startTime = Date.now();
      this.lastChunkTime = this.startTime;

      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      this.mediaRecorder = new MediaRecorder(destinationStream, options);

      this.mediaRecorder.ondataavailable = async (event: BlobEvent) => {
        if (event.data && event.data.size > 0 && this.currentSessionId) {
          const now = Date.now();
          const duration = now - this.lastChunkTime;
          this.lastChunkTime = now;

          const chunkMeta: RecordingChunkMetadata = {
            sessionId: this.currentSessionId,
            chunkIndex: this.chunkIndex,
            sequenceNumber: this.chunkIndex + 1,
            timestamp: now,
            durationMs: duration,
            byteLength: event.data.size,
            mimeType: this.mediaRecorder?.mimeType || 'audio/webm',
            isInitChunk: this.chunkIndex === 0,
            data: event.data,
          };

          this.chunkIndex += 1;
          await recordingStorage.saveChunk(chunkMeta);
        }
      };

      this.mediaRecorder.onerror = (err) => {
        console.error('[RecordingService] MediaRecorder error:', err);
        this.setStatus('error');
      };

      this.mediaRecorder.onstop = () => {
        console.log('[RecordingService] MediaRecorder stopped');
      };

      // Request 10-second slices (10,000 ms) as specified by F4 Section 16
      this.mediaRecorder.start(10000);
      this.setStatus('recording');
      return true;
    } catch (err) {
      console.error('[RecordingService] Failed to start recording:', err);
      this.setStatus('error');
      return false;
    }
  }

  /**
   * Stop recording and finalize current session in storage
   */
  async stopRecording(): Promise<RecordingSessionManifest | null> {
    if (!this.mediaRecorder || this.status !== 'recording') {
      return null;
    }

    this.setStatus('finalizing');
    const sessionId = this.currentSessionId;

    return new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.requestData(); // Flush last chunk
        this.mediaRecorder.stop();
      }

      setTimeout(async () => {
        let manifest: RecordingSessionManifest | null = null;
        if (sessionId) {
          manifest = await recordingStorage.finalizeSession(sessionId);
        }
        this.setStatus('finalized');
        this.mediaRecorder = null;
        this.currentSessionId = null;
        resolve(manifest);
      }, 500);
    });
  }

  /**
   * Export the recorded audio session
   */
  async exportRecording(sessionId: string): Promise<string | null> {
    const res = await recordingStorage.assembleRecording(sessionId);
    if (!res) return null;
    return URL.createObjectURL(res.blob);
  }
}

export const recordingService = new RecordingService();

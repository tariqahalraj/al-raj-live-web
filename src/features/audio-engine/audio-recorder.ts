/**
 * AudioRecorder.ts
 * High-quality audio recording for Tariqah al-Raj Host broadcast.
 * Records the live processed audio stream directly from AudioEngine / MediaStream
 * and exports as standard Opus/WebM or AAC file for instant playback & download.
 */

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingStartTime: number = 0;
  private isRecordingActive: boolean = false;
  private mimeType: string = '';

  constructor() {
    this.detectSupportedMimeType();
  }

  private detectSupportedMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';

    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        this.mimeType = type;
        return type;
      }
    }

    this.mimeType = '';
    return '';
  }

  /**
   * Start recording from the given MediaStream
   */
  start(stream: MediaStream): boolean {
    if (this.isRecordingActive) return false;
    if (!stream || stream.getAudioTracks().length === 0) {
      console.warn('[AudioRecorder] Cannot start recording: no audio tracks found in stream.');
      return false;
    }

    try {
      this.recordedChunks = [];
      const options: MediaRecorderOptions = {};
      if (this.mimeType) {
        options.mimeType = this.mimeType;
      }

      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      // Request data in 1-second chunks to ensure memory safety
      this.mediaRecorder.start(1000);
      this.isRecordingActive = true;
      this.recordingStartTime = Date.now();

      console.log('[AudioRecorder] Live recording started with mimeType:', this.mediaRecorder.mimeType || 'default');
      return true;
    } catch (err) {
      console.error('[AudioRecorder] Failed to start MediaRecorder:', err);
      this.isRecordingActive = false;
      return false;
    }
  }

  /**
   * Stop recording and return the completed audio Blob
   */
  async stop(): Promise<Blob | null> {
    if (!this.isRecordingActive || !this.mediaRecorder) {
      return null;
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        this.isRecordingActive = false;
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const finalMime = this.mediaRecorder?.mimeType || this.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.recordedChunks, { type: finalMime });
        this.isRecordingActive = false;
        this.recordedChunks = [];
        this.mediaRecorder = null;
        console.log('[AudioRecorder] Live recording stopped. Total size:', audioBlob.size, 'bytes');
        resolve(audioBlob);
      };

      try {
        this.mediaRecorder.stop();
      } catch (err) {
        console.warn('[AudioRecorder] Exception stopping MediaRecorder:', err);
        this.isRecordingActive = false;
        resolve(null);
      }
    });
  }

  isRecording(): boolean {
    return this.isRecordingActive;
  }

  getElapsedSeconds(): number {
    if (!this.isRecordingActive || !this.recordingStartTime) return 0;
    return Math.floor((Date.now() - this.recordingStartTime) / 1000);
  }

  /**
   * Generate a unique, timestamped filename for recording
   */
  generateFilename(sessionTitle?: string, mimeType?: string): string {
    const dateStr = new Date().toISOString().slice(0, 10);
    const cleanTitle = (sessionTitle || 'Zikr-Session').replace(/[^a-zA-Z0-9-_]/g, '_');
    const ext = mimeType && mimeType.includes('mp4') ? 'm4a' : 'webm';
    return `Tariqah_${cleanTitle}_${dateStr}_${Date.now()}.${ext}`;
  }

  /**
   * Save recorded audio file to device storage:
   * - On Android phone (APK): saves to "Downloads/TariqahLive/[filename]"
   * - In web browser: downloads to user's "Downloads" folder
   */
  async download(blob: Blob, sessionTitle?: string, explicitFilename?: string): Promise<string> {
    if (!blob || blob.size === 0) return '';

    const filename = explicitFilename || this.generateFilename(sessionTitle, blob.type);

    // 1. Check if running inside native Android Capacitor app
    try {
      const isCapacitor = typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === 'function'
        && Boolean((window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform());

      if (isCapacitor) {
        const { registerPlugin } = await import('@capacitor/core');
        const LiveBackground = registerPlugin<{
          saveAudioRecording: (options: { base64Data: string; filename: string; mimeType: string }) => Promise<{ success: boolean; path: string }>;
        }>('LiveBackgroundService');

        // Convert Blob to Base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);
        const base64Data = await base64Promise;

        const res = await LiveBackground.saveAudioRecording({
          base64Data,
          filename,
          mimeType: blob.type || 'audio/webm',
        });

        console.log('[AudioRecorder] Saved natively to device:', res?.path);
        return res?.path || `Downloads/TariqahLive/${filename}`;
      }
    } catch (nativeErr) {
      console.warn('[AudioRecorder] Native save error, using browser download:', nativeErr);
    }

    // 2. Standard Web Browser download fallback
    try {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.style.display = 'none';
      anchor.href = url;
      anchor.download = filename;

      document.body.appendChild(anchor);
      anchor.click();

      setTimeout(() => {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }, 2000);

      return `Downloads/${filename}`;
    } catch (err) {
      console.warn('[AudioRecorder] Failed to trigger download:', err);
      return '';
    }
  }
}


export const audioRecorder = new AudioRecorder();

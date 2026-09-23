/**
 * recordings-manager.ts
 * Manages persistent storage and playback of host live audio recordings.
 * Scans and reads directly from the native device directory (Downloads/TariqahLive)
 * and merges with IndexedDB storage for offline & web support.
 */

export interface AppRecording {
  id: string;
  title: string;
  filename: string;
  blob?: Blob;
  sizeBytes: number;
  durationSeconds: number;
  createdAt: string;
  mimeType: string;
  savedPath?: string;
  contentUri?: string;
}

const DB_NAME = 'tariqah_live_recordings';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;

class RecordingsManager {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported in this environment'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        this.dbPromise = null;
        reject(req.error);
      };
    });

    return this.dbPromise;
  }

  /**
   * Save a completed recording blob to IndexedDB
   */
  async saveRecording(options: {
    title: string;
    blob: Blob;
    durationSeconds: number;
    savedPath?: string;
    filename?: string;
  }): Promise<AppRecording> {
    const dateStr = new Date().toISOString().slice(0, 10);
    const cleanTitle = (options.title || 'Zikr-Session').replace(/[^a-zA-Z0-9-_]/g, '_');
    const ext = options.blob.type.includes('mp4') ? 'm4a' : 'webm';
    const filename = options.filename || `Tariqah_${cleanTitle}_${dateStr}_${Date.now()}.${ext}`;
    const id = filename;

    const recording: AppRecording = {
      id,
      title: options.title || 'Zikr Session',
      filename,
      blob: options.blob,
      sizeBytes: options.blob.size,
      durationSeconds: options.durationSeconds || 0,
      createdAt: new Date().toISOString(),
      mimeType: options.blob.type || 'audio/webm',
      savedPath: options.savedPath,
    };

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(recording);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[RecordingsManager] IndexedDB save error:', err);
    }

    return recording;
  }

  /**
   * Fetch all recordings directly from native device directory (Downloads/TariqahLive)
   * and IndexedDB, sorted newest first. Automatically purges 0-byte ghost entries.
   */
  async getAllRecordings(): Promise<AppRecording[]> {
    const listMap = new Map<string, AppRecording>();

    // 1. Fetch from IndexedDB first (authoritative source for Blobs and durations)
    try {
      const db = await this.getDB();
      const dbList: AppRecording[] = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      const purgeIds: string[] = [];

      for (const rec of dbList) {
        const realSize = rec.blob?.size || rec.sizeBytes || 0;
        // Purge invalid or 0-byte recordings
        if (realSize <= 0) {
          purgeIds.push(rec.id);
          continue;
        }

        let cleanTitle = rec.title;
        if (!cleanTitle || cleanTitle === 'Zikr-Session') {
          cleanTitle = 'Zikr Session';
        }

        listMap.set(rec.filename, {
          ...rec,
          title: cleanTitle,
          sizeBytes: realSize,
        });
      }

      // Auto-purge any stale 0-byte entries from IndexedDB
      if (purgeIds.length > 0) {
        try {
          const delTx = db.transaction(STORE_NAME, 'readwrite');
          const delStore = delTx.objectStore(STORE_NAME);
          purgeIds.forEach((id) => delStore.delete(id));
        } catch (e) {
          console.warn('[RecordingsManager] Auto-purge notice:', e);
        }
      }
    } catch (idbErr) {
      console.warn('[RecordingsManager] IndexedDB list error:', idbErr);
    }

    // 2. Fetch from native Android directory (Downloads/TariqahLive) via LiveBackgroundService
    try {
      const isCapacitor = typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === 'function'
        && Boolean((window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform());

      if (isCapacitor) {
        const { registerPlugin } = await import('@capacitor/core');
        const LiveBackground = registerPlugin<{
          listSavedRecordings: () => Promise<{ recordings: Array<{
            filename: string;
            path?: string;
            contentUri?: string;
            sizeBytes: number;
            createdAt: string;
            timestamp?: number;
            mimeType: string;
          }> }>;
        }>('LiveBackgroundService');

        const nativeRes = await LiveBackground.listSavedRecordings();
        if (nativeRes?.recordings && Array.isArray(nativeRes.recordings)) {
          for (const item of nativeRes.recordings) {
            // Strictly skip 0-byte or invalid native items
            if (!item.sizeBytes || item.sizeBytes <= 0) {
              continue;
            }

            // If exact filename is already loaded from IndexedDB, merge paths/URIs without duplicating
            if (listMap.has(item.filename)) {
              const existing = listMap.get(item.filename)!;
              existing.savedPath = item.path || existing.savedPath;
              existing.contentUri = item.contentUri || existing.contentUri;
              if (item.sizeBytes > existing.sizeBytes) {
                existing.sizeBytes = item.sizeBytes;
              }
              continue;
            }

            // Also check for near-timestamp match (within 15 seconds) to prevent duplicate from slight timestamp offset
            const itemTime = item.timestamp || new Date(item.createdAt).getTime();
            let merged = false;

            for (const [, existing] of listMap) {
              const existingTime = new Date(existing.createdAt).getTime();
              if (Math.abs(existingTime - itemTime) < 15000) {
                existing.savedPath = item.path || existing.savedPath;
                existing.contentUri = item.contentUri || existing.contentUri;
                merged = true;
                break;
              }
            }

            if (merged) continue;

            // Otherwise, this is a distinct native recording file (e.g. from previous install or USB)
            let cleanTitle = item.filename
              .replace(/\.(webm|m4a|mp4|wav|aac)$/i, '')
              .replace(/^Tariqah_/i, '')
              .replace(/_\d{4}-\d{2}-\d{2}_\d+$/, '')
              .replace(/_/g, ' ')
              .trim();
            if (!cleanTitle) cleanTitle = 'Live Audio Recording';

            listMap.set(item.filename, {
              id: item.filename,
              title: cleanTitle,
              filename: item.filename,
              sizeBytes: item.sizeBytes,
              durationSeconds: 0,
              createdAt: item.timestamp ? new Date(item.timestamp).toISOString() : new Date(item.createdAt).toISOString(),
              mimeType: item.mimeType || (item.filename.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm'),
              savedPath: item.path || `Downloads/TariqahLive/${item.filename}`,
              contentUri: item.contentUri,
            });
          }
        }
      }
    } catch (nativeErr) {
      console.warn('[RecordingsManager] Native directory scan error:', nativeErr);
    }

    const list = Array.from(listMap.values()).filter((rec) => rec.sizeBytes > 0);

    // Sort newest first
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }

  /**
   * Resolve an audio Blob for playback from native file or IndexedDB
   */
  async getAudioBlob(rec: AppRecording): Promise<Blob | null> {
    if (rec.blob && rec.blob.size > 0) return rec.blob;

    // Check native plugin
    try {
      const isCapacitor = typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === 'function'
        && Boolean((window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform());

      if (isCapacitor) {
        const { registerPlugin } = await import('@capacitor/core');
        const LiveBackground = registerPlugin<{
          getRecordingData: (options: { filename?: string; path?: string; contentUri?: string }) => Promise<{
            base64Data: string;
            mimeType: string;
            sizeBytes: number;
          }>;
        }>('LiveBackgroundService');

        const res = await LiveBackground.getRecordingData({
          filename: rec.filename,
          path: rec.savedPath,
          contentUri: rec.contentUri,
        });

        if (res?.base64Data) {
          const binaryString = atob(res.base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: res.mimeType || rec.mimeType || 'audio/webm' });
          rec.blob = blob;
          return blob;
        }
      }
    } catch (nativeErr) {
      console.warn('[RecordingsManager] Failed to read native audio:', nativeErr);
    }

    // Check IndexedDB
    try {
      const db = await this.getDB();
      const idbItem: AppRecording | undefined = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(rec.id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (idbItem?.blob && idbItem.blob.size > 0) {
        rec.blob = idbItem.blob;
        return idbItem.blob;
      }
    } catch (e) {}

    return null;
  }

  /**
   * Delete a recording from both device filesystem and IndexedDB
   */
  async deleteRecording(rec: AppRecording): Promise<boolean> {
    // 1. Delete natively if on Android
    try {
      const isCapacitor = typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === 'function'
        && Boolean((window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform());

      if (isCapacitor) {
        const { registerPlugin } = await import('@capacitor/core');
        const LiveBackground = registerPlugin<{
          deleteRecordingFile: (options: { filename?: string; path?: string; contentUri?: string }) => Promise<{ success: boolean }>;
        }>('LiveBackgroundService');

        await LiveBackground.deleteRecordingFile({
          filename: rec.filename,
          path: rec.savedPath,
          contentUri: rec.contentUri,
        });
      }
    } catch (nativeErr) {
      console.warn('[RecordingsManager] Native delete error:', nativeErr);
    }

    // 2. Delete from IndexedDB
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(rec.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {}

    return true;
  }

  /**
   * Generates a sample synthesized test recording for demonstration/testing
   */
  async createSampleRecording(title: string = 'Test Zikr Audio'): Promise<AppRecording> {
    const sampleRate = 44100;
    const durationSec = 4;
    const numSamples = sampleRate * durationSec;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // Write WAV Header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    const freq = 432;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.3 * Math.exp(-t * 0.5);
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return this.saveRecording({
      title,
      blob,
      durationSeconds: durationSec,
      savedPath: 'Internal Storage > Downloads > TariqahLive',
    });
  }
}

export const recordingsManager = new RecordingsManager();

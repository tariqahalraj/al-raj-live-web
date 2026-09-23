import { RecordingChunkMetadata, RecordingSessionManifest } from './types';

const DB_NAME = 'tariqah_recording_db';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks';
const SESSIONS_STORE = 'sessions';

export class RecordingStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          const chunkStore = db.createObjectStore(CHUNKS_STORE, { keyPath: ['sessionId', 'chunkIndex'] });
          chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  /**
   * Save a single 10-second audio chunk to persistent storage and release memory
   */
  async saveChunk(chunk: RecordingChunkMetadata): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CHUNKS_STORE, SESSIONS_STORE], 'readwrite');
      const chunkStore = tx.objectStore(CHUNKS_STORE);
      const sessionStore = tx.objectStore(SESSIONS_STORE);

      chunkStore.put(chunk);

      // Update session manifest total bytes & count
      const sessionReq = sessionStore.get(chunk.sessionId);
      sessionReq.onsuccess = () => {
        const manifest: RecordingSessionManifest = sessionReq.result || {
          sessionId: chunk.sessionId,
          sessionTitle: 'Session Recording',
          startedAt: chunk.timestamp,
          durationMs: 0,
          chunkCount: 0,
          totalBytes: 0,
          mimeType: chunk.mimeType,
          isFinalized: false,
        };

        manifest.chunkCount += 1;
        manifest.totalBytes += chunk.byteLength;
        manifest.durationMs += chunk.durationMs;

        sessionStore.put(manifest);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get all chunks for a session ordered by chunkIndex
   */
  async getChunks(sessionId: string): Promise<RecordingChunkMetadata[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readonly');
      const store = tx.objectStore(CHUNKS_STORE);
      const index = store.index('sessionId');
      const req = index.getAll(sessionId);

      req.onsuccess = () => {
        const chunks: RecordingChunkMetadata[] = req.result;
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        resolve(chunks);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Finalize session: marks session as complete and prepares export
   */
  async finalizeSession(sessionId: string): Promise<RecordingSessionManifest | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readwrite');
      const store = tx.objectStore(SESSIONS_STORE);
      const req = store.get(sessionId);

      req.onsuccess = () => {
        const manifest: RecordingSessionManifest = req.result;
        if (manifest) {
          manifest.isFinalized = true;
          manifest.endedAt = Date.now();
          store.put(manifest);
          resolve(manifest);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Assemble chunks into a playable Blob when user requests download/export
   */
  async assembleRecording(sessionId: string): Promise<{ blob: Blob; mimeType: string } | null> {
    const chunks = await this.getChunks(sessionId);
    if (chunks.length === 0) return null;

    const mimeType = chunks[0].mimeType || 'audio/webm;codecs=opus';
    const blobParts = chunks.map((c) => c.data);
    const fullBlob = new Blob(blobParts, { type: mimeType });
    return { blob: fullBlob, mimeType };
  }

  /**
   * Delete session and all related chunks
   */
  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.getDB();
    const chunks = await this.getChunks(sessionId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CHUNKS_STORE, SESSIONS_STORE], 'readwrite');
      const chunkStore = tx.objectStore(CHUNKS_STORE);
      const sessionStore = tx.objectStore(SESSIONS_STORE);

      chunks.forEach((chunk) => {
        chunkStore.delete([sessionId, chunk.chunkIndex]);
      });
      sessionStore.delete(sessionId);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const recordingStorage = new RecordingStorage();

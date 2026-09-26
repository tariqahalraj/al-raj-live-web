import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

export interface OtaManifest {
  version: string;
  url: string;
  checksum?: string;
  sizeBytes?: number;
  sizeFormatted?: string;
  whatsNew?: string[];
  minNativeVersion?: string;
  releaseDate?: string;
  notes?: string;
  mandatory?: boolean;
}

export interface OtaState {
  currentVersion: string;
  availableVersion: string | null;
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  errorMessage: string | null;
  progress: number;
  sizeFormatted: string | null;
  whatsNew: string[];
}

const DEFAULT_MANIFEST_URL = 'https://pub-1ef49b55ff214047ba5139361e0a6c3c.r2.dev/version.json';

class OtaManager {
  private state: OtaState = {
    currentVersion: '1.0.0',
    availableVersion: null,
    status: 'idle',
    errorMessage: null,
    progress: 0,
    sizeFormatted: null,
    whatsNew: [],
  };

  private listeners: Array<(state: OtaState) => void> = [];
  private isInitialized = false;
  private isCheckInProgress = false;

  public getState(): OtaState {
    return { ...this.state };
  }

  public subscribe(listener: (state: OtaState) => void): () => void {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach((l) => {
      try {
        l(currentState);
      } catch (err) {
        console.error('[OTA] Error in listener:', err);
      }
    });
  }

  /**
   * Compare two semver strings (e.g., '1.0.1' > '1.0.0').
   * Returns:
   *  1 if a > b
   * -1 if a < b
   *  0 if a === b
   */
  public compareVersions(a: string, b: string): number {
    const cleanA = a.replace(/^v/, '').trim();
    const cleanB = b.replace(/^v/, '').trim();

    const partsA = cleanA.split('.').map((p) => parseInt(p, 10) || 0);
    const partsB = cleanB.split('.').map((p) => parseInt(p, 10) || 0);

    const maxLength = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLength; i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  }

  /**
   * Initializes OTA Updater on application boot.
   * On Native platforms:
   * 1. Confirms the current bundle to prevent native watchdog rollbacks.
   * 2. Checks Cloudflare R2 for newer dist/ bundles.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Web browsers always load the latest bundle directly from the server
    if (!Capacitor.isNativePlatform()) {
      this.state.status = 'up-to-date';
      this.notify();
      return;
    }

    try {
      // 1. Confirm bundle health immediately on startup
      const readyResult = await CapacitorUpdater.notifyAppReady();
      const currentBundleVersion = readyResult?.bundle?.version || '1.0.0';
      this.state.currentVersion = currentBundleVersion;
      console.log('[OTA] Native bundle ready. Active version:', currentBundleVersion);
      this.notify();

      // 2. Initial background check after 2 seconds
      setTimeout(() => {
        this.checkForUpdate().catch(() => {});
      }, 2000);

      // 3. Periodic background check every 60 seconds while app is active
      setInterval(() => {
        if (this.state.status !== 'downloading' && this.state.status !== 'ready') {
          this.checkForUpdate().catch(() => {});
        }
      }, 60 * 1000);

      // 4. Trigger check whenever app returns to foreground or phone is unlocked
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (this.state.status !== 'downloading' && this.state.status !== 'ready') {
            this.checkForUpdate().catch(() => {});
          }
        }
      });

      // 5. Trigger check on window focus
      window.addEventListener('focus', () => {
        if (this.state.status !== 'downloading' && this.state.status !== 'ready') {
          this.checkForUpdate().catch(() => {});
        }
      });

      // 6. Trigger check when network reconnects
      window.addEventListener('online', () => {
        this.checkForUpdate().catch(() => {});
      });
    } catch (err) {
      console.warn('[OTA] Error notifying app ready:', err);
    }
  }

  /**
   * Checks Cloudflare R2 for new version.json manifest.
   */
  public async checkForUpdate(manualTrigger = false): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    if (this.isCheckInProgress) {
      return false;
    }
    this.isCheckInProgress = true;

    const manifestUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OTA_MANIFEST_URL) ||
      DEFAULT_MANIFEST_URL;

    this.state.status = 'checking';
    this.state.errorMessage = null;
    this.notify();

    try {
      // Get current active version from native layer
      try {
        const cur = await CapacitorUpdater.current();
        if (cur?.bundle?.version) {
          this.state.currentVersion = cur.bundle.version;
        }
      } catch {
        // Fallback to existing state version
      }

      // Fetch manifest using native CapacitorHttp to bypass WebView CORS
      let manifest: OtaManifest;
      if (Capacitor.isNativePlatform()) {
        const httpRes = await CapacitorHttp.get({
          url: `${manifestUrl}?t=${Date.now()}`,
          headers: {
            'Cache-Control': 'no-cache, no-store',
            Accept: 'application/json',
          },
        });
        if (httpRes.status < 200 || httpRes.status >= 300) {
          throw new Error(`Failed to fetch version manifest (HTTP ${httpRes.status})`);
        }
        manifest = typeof httpRes.data === 'string' ? JSON.parse(httpRes.data) : httpRes.data;
      } else {
        const res = await fetch(`${manifestUrl}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
          },
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch version manifest (HTTP ${res.status})`);
        }
        manifest = await res.json();
      }

      if (!manifest.version || !manifest.url) {
        throw new Error('Invalid version manifest: missing version or url');
      }

      console.log('[OTA] Remote version found:', manifest.version, 'Current:', this.state.currentVersion);

      const hasNewVersion = this.compareVersions(manifest.version, this.state.currentVersion) > 0;

      if (!hasNewVersion) {
        this.state.status = 'up-to-date';
        this.state.availableVersion = null;
        this.notify();
        return false;
      }

      this.state.availableVersion = manifest.version;
      this.state.sizeFormatted = manifest.sizeFormatted || (manifest.sizeBytes ? `~${Math.round(manifest.sizeBytes / 1024)} KB` : '~720 KB');
      this.state.whatsNew = Array.isArray(manifest.whatsNew) && manifest.whatsNew.length > 0
        ? manifest.whatsNew
        : [
            manifest.notes && !manifest.notes.startsWith('OTA Update v')
              ? manifest.notes
              : 'New Over-The-Air (OTA) live update delivery system',
            'Enhanced background live audio stability & reconnection',
            'Real-time listener profile & role synchronization',
            'Refined Tariqah al-Raj spiritual portal UI design',
          ];
      this.state.status = 'downloading';
      this.state.progress = 0;
      this.notify();

      // Download bundle from Cloudflare R2
      console.log(`[OTA] Downloading bundle version ${manifest.version} from ${manifest.url}...`);
      const bundle = await CapacitorUpdater.download({
        url: manifest.url,
        version: manifest.version,
        checksum: manifest.checksum,
      });

      console.log(`[OTA] Bundle ${bundle.id} downloaded successfully.`);

      if (manifest.mandatory) {
        // Mandatory update: apply immediately and reload
        console.log('[OTA] Mandatory update: Applying and reloading immediately...');
        await CapacitorUpdater.set({ id: bundle.id });
      } else {
        // Non-mandatory update: set as next bundle to apply smoothly on background or restart
        await CapacitorUpdater.next({ id: bundle.id });
        this.state.status = 'ready';
        this.notify();
      }

      return true;
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[OTA] Update check or download error:', error);
      this.state.status = 'error';
      this.state.errorMessage = error.message || 'Update check failed';
      this.notify();
      if (manualTrigger) throw error;
      return false;
    } finally {
      this.isCheckInProgress = false;
    }
  }

  /**
   * Manually trigger reload to activate a downloaded bundle.
   */
  public async reloadApp(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      window.location.reload();
      return;
    }
    try {
      await CapacitorUpdater.reload();
    } catch {
      window.location.reload();
    }
  }
}

export const otaManager = new OtaManager();

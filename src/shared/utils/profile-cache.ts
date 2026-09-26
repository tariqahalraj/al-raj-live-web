import { supabase } from '@/core/supabase-client';
import { getAssetUrl } from '@/shared/utils/asset';

export interface CachedProfile {
  id: string;
  fullName: string;
  avatarUrl?: string;
  role: 'USER' | 'HOST' | 'ADMIN';
  cachedAt: number;
}

class ProfileCacheManager {
  private memoryCache = new Map<string, CachedProfile>();
  private preloadedImages = new Set<string>();
  private pendingFetches = new Map<string, Promise<CachedProfile | null>>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes fresh TTL

  constructor() {
    this.hydrateFromStorage();
  }

  private hydrateFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k.startsWith('tariqah_profile_cache_')) {
          const itemStr = localStorage.getItem(k);
          if (itemStr) {
            const p = JSON.parse(itemStr) as CachedProfile;
            if (p?.id) {
              this.memoryCache.set(p.id, p);
              if (p.avatarUrl) {
                this.preloadImage(p.avatarUrl);
              }
            }
          }
        }
      }
    } catch {}
  }

  preloadImage(url?: string) {
    if (!url || typeof window === 'undefined') return;
    const resolvedUrl = getAssetUrl(url);
    if (this.preloadedImages.has(resolvedUrl)) return;
    this.preloadedImages.add(resolvedUrl);

    const img = new Image();
    img.src = resolvedUrl;
    if ('decode' in img) {
      img.decode().catch(() => {});
    }
  }

  getSync(userId: string): CachedProfile | null {
    if (!userId) return null;
    return this.memoryCache.get(userId) || null;
  }

  set(profile: { id: string; fullName?: string; avatarUrl?: string; role?: 'USER' | 'HOST' | 'ADMIN' }) {
    if (!profile?.id) return;
    const cached: CachedProfile = {
      id: profile.id,
      fullName: profile.fullName || 'Member',
      avatarUrl: profile.avatarUrl,
      role: profile.role || 'USER',
      cachedAt: Date.now(),
    };
    this.memoryCache.set(profile.id, cached);
    if (cached.avatarUrl) {
      this.preloadImage(cached.avatarUrl);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`tariqah_profile_cache_${profile.id}`, JSON.stringify(cached));
      } catch {}
    }
  }

  async getFast(userId: string, allowStale = true): Promise<CachedProfile | null> {
    if (!userId) return null;

    const existing = this.memoryCache.get(userId);
    const isFresh = existing && (Date.now() - existing.cachedAt < this.TTL_MS);

    if (existing && (isFresh || allowStale)) {
      if (!isFresh) {
        this.fetchRemote(userId).catch(() => {});
      }
      return existing;
    }

    return this.fetchRemote(userId);
  }

  private async fetchRemote(userId: string): Promise<CachedProfile | null> {
    if (this.pendingFetches.has(userId)) {
      return this.pendingFetches.get(userId)!;
    }

    const fetchPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, role')
          .eq('id', userId)
          .maybeSingle();

        if (!error && data) {
          const profile: CachedProfile = {
            id: data.id,
            fullName: data.full_name || 'Member',
            avatarUrl: data.avatar_url,
            role: (data.role as 'USER' | 'HOST' | 'ADMIN') || 'USER',
            cachedAt: Date.now(),
          };
          this.set(profile);
          return profile;
        }
      } catch (err) {
        console.warn('[ProfileCache] Error fetching profile:', err);
      } finally {
        this.pendingFetches.delete(userId);
      }
      return this.memoryCache.get(userId) || null;
    })();

    this.pendingFetches.set(userId, fetchPromise);
    return fetchPromise;
  }

  async batchPrime(userIds: string[]): Promise<void> {
    const missing = userIds.filter((id) => !this.memoryCache.has(id));
    if (missing.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .in('id', missing);

      if (!error && Array.isArray(data)) {
        data.forEach((item) => {
          this.set({
            id: item.id,
            fullName: item.full_name,
            avatarUrl: item.avatar_url,
            role: item.role as 'USER' | 'HOST' | 'ADMIN',
          });
        });
      }
    } catch (e) {
      console.warn('[ProfileCache] Batch prime notice:', e);
    }
  }
}

export const profileCache = new ProfileCacheManager();

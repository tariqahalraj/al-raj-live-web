import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../core/supabase-client';
import { useAppStore } from '../../shared/stores/app-store';

export interface PresenceUser {
  id: string;
  name: string;
  avatarUrl?: string;
  isHost?: boolean;
}

export interface BannedUser {
  id: string;
  name: string;
  avatarUrl?: string;
  bannedAt: string;
  role?: 'USER' | 'HOST' | 'ADMIN';
}

export class PresenceManager {
  private hostLeaseTimer: number | null = null;
  private listenerLeaseTimer: number | null = null;
  private fallbackTimer: number | null = null;
  private presenceChannel: RealtimeChannel | null = null;
  private currentSessionId: string | null = null;
  private currentUser: PresenceUser | null = null;
  private consecutiveLeaseFailures: number = 0;
  private dbListeners: Map<string, { id: string; name: string; avatarUrl?: string }> = new Map();
  private kickedUserIds: Set<string> = new Set();
  private bannedUsers: Map<string, BannedUser> = new Map();
  private rejoinRequestListeners: Set<(payload: { userId: string; userName: string; sessionId?: string }) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('tariqah_banned_users');
        if (stored) {
          const list: BannedUser[] = JSON.parse(stored);
          list.forEach((u) => this.bannedUsers.set(u.id, u));
        }
      } catch (e) {}

      window.addEventListener('beforeunload', () => {
        this.leavePresence();
      });

      // Mobile app resume handlers: immediately refresh presence when user returns to app
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.handleVisibilityResume();
        }
      });

      window.addEventListener('focus', () => {
        this.handleVisibilityResume();
      });
    }
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getIsHost(): boolean {
    return Boolean(this.currentUser?.isHost);
  }

  /**
   * Handle app regaining foreground visibility / focus after being backgrounded or minimized
   */
  async handleVisibilityResume() {
    if (!this.currentSessionId || !this.currentUser) return;
    console.log('[PresenceManager] App resumed focus/visibility. Re-synchronizing presence...');

    // 1. Immediately refresh database listeners via fast HTTP RPC
    await this.fetchDbListeners(this.currentSessionId);

    // 2. Immediately renew lease
    if (this.currentUser.isHost) {
      this.renewHostLease(this.currentSessionId);
    } else {
      this.renewListenerLease(this.currentSessionId);
    }

    // 3. Ensure Realtime presence channel is alive & tracking
    if (this.presenceChannel) {
      try {
        await this.presenceChannel.track({
          id: this.currentUser.id,
          name: this.currentUser.name,
          avatarUrl: this.currentUser.avatarUrl,
          isHost: Boolean(this.currentUser.isHost),
          joinedAt: new Date().toISOString(),
        });
        this.mergeAndPublishPresence();
      } catch (err) {
        console.warn('[PresenceManager] Error re-tracking on visibility resume:', err);
      }
    }
  }

  /**
   * Start host lease renewal loop (renewing every 15s; server-controlled expiry 90s)
   */
  startHostLeaseLoop(sessionId: string) {
    this.stopHostLeaseLoop();
    this.currentSessionId = sessionId;
    this.consecutiveLeaseFailures = 0;

    // Renew immediately
    this.renewHostLease(sessionId);

    // Renew every 15,000 ms
    this.hostLeaseTimer = window.setInterval(() => {
      this.renewHostLease(sessionId);
    }, 15000);
  }

  private async renewHostLease(sessionId: string) {
    try {
      const { error } = await supabase.rpc('renew_host_lease', {
        target_session_id: sessionId,
      });

      if (error) {
        this.consecutiveLeaseFailures += 1;
        console.warn(`[PresenceManager] Host lease renewal warning (${this.consecutiveLeaseFailures}):`, error.message);
      } else {
        this.consecutiveLeaseFailures = 0;
      }
    } catch (err) {
      console.warn('[PresenceManager] Exception in host lease renewal:', err);
    }
  }

  stopHostLeaseLoop() {
    if (this.hostLeaseTimer) {
      clearInterval(this.hostLeaseTimer);
      this.hostLeaseTimer = null;
    }
    this.consecutiveLeaseFailures = 0;
  }

  /**
   * Start listener lease renewal loop (renewing every 10s; server-controlled expiry 90s)
   */
  private startListenerLeaseLoop(sessionId: string) {
    this.stopListenerLeaseLoop();
    this.renewListenerLease(sessionId);

    this.listenerLeaseTimer = window.setInterval(() => {
      this.renewListenerLease(sessionId);
    }, 10000);
  }

  private async renewListenerLease(sessionId: string) {
    try {
      await supabase.rpc('renew_listener_lease', {
        p_session_id: sessionId,
        p_instance_id: this.currentUser?.id ? `listener-${this.currentUser.id}` : 'listener-client',
      });
    } catch (err) {
      console.warn('[PresenceManager] Exception in listener lease renewal:', err);
    }
  }

  private stopListenerLeaseLoop() {
    if (this.listenerLeaseTimer) {
      clearInterval(this.listenerLeaseTimer);
      this.listenerLeaseTimer = null;
    }
  }

  /**
   * Fallback DB sync: Query active session listeners every 3.5 seconds
   * Guarantees listeners and counts never stay empty even if WebSocket drops or reconnects.
   * Runs for both host and listeners.
   */
  private startFallbackSync(sessionId: string) {
    this.stopFallbackSync();

    this.fetchDbListeners(sessionId);
    this.fallbackTimer = window.setInterval(() => {
      this.fetchDbListeners(sessionId);
    }, 2000);
  }

  private async fetchDbListeners(sessionId: string) {
    if (!sessionId) return;
    try {
      const { data, error } = await supabase.rpc('get_active_session_listeners', {
        p_session_id: sessionId,
      });

      if (!error && Array.isArray(data)) {
        const freshMap = new Map<string, { id: string; name: string; avatarUrl?: string }>();
        data.forEach((item: { id: string; name: string; avatar_url?: string }) => {
          if (item?.id) {
            freshMap.set(item.id, {
              id: item.id,
              name: item.name || 'Brother in Islam',
              avatarUrl: item.avatar_url,
            });
          }
        });
        this.dbListeners = freshMap;
        this.mergeAndPublishPresence();
      }
    } catch (err) {
      console.warn('[PresenceManager] Error in fallback listener sync:', err);
    }
  }

  private stopFallbackSync() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /**
   * Merge Realtime channel presence state + Database heartbeat leases
   * into a single authoritative, deduplicated participant list.
   */
  private mergeAndPublishPresence() {
    const userMap = new Map<string, { id: string; name: string; avatarUrl?: string; isHost?: boolean }>();

    // 1. Add database-backed listeners
    this.dbListeners.forEach((l) => {
      userMap.set(l.id, {
        id: l.id,
        name: l.name,
        avatarUrl: l.avatarUrl,
        isHost: false,
      });
    });

    // 2. Add / overlay Realtime presence channel state
    if (this.presenceChannel) {
      const presenceState = this.presenceChannel.presenceState();
      Object.values(presenceState).forEach((presences) => {
        presences.forEach((p: unknown) => {
          const item = p as { id?: string; name?: string; avatarUrl?: string; isHost?: boolean };
          if (item?.id) {
            userMap.set(item.id, {
              id: item.id,
              name: item.name || (item.isHost ? 'Our Murshid' : 'Brother in Islam'),
              avatarUrl: item.avatarUrl,
              isHost: Boolean(item.isHost),
            });
          }
        });
      });
    }

    // 3. Ensure current active user is always included
    if (this.currentUser?.id) {
      userMap.set(this.currentUser.id, {
        id: this.currentUser.id,
        name: this.currentUser.name || (this.currentUser.isHost ? 'Our Murshid' : 'Brother in Islam'),
        avatarUrl: this.currentUser.avatarUrl,
        isHost: Boolean(this.currentUser.isHost),
      });
    }

    const newParticipants = Array.from(userMap.values())
      .filter((u) => !this.kickedUserIds.has(u.id) && !this.bannedUsers.has(u.id))
      .map((u) => ({
        id: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        isHost: Boolean(u.isHost),
        isOnline: true,
      }));

    const currentParticipants = useAppStore.getState().participants;

    // Guard against clearing active list during temporary reconnect blips
    if (newParticipants.length === 0 && currentParticipants.length > 0 && this.currentSessionId) {
      return;
    }

    const listenerCount = newParticipants.filter((u) => !u.isHost).length;

    // 4. Shallow equality check: only dispatch store updates if participants actually changed
    const isSame =
      currentParticipants.length === newParticipants.length &&
      currentParticipants.every((p, idx) => {
        const np = newParticipants[idx];
        return (
          np &&
          p.id === np.id &&
          p.name === np.name &&
          p.avatarUrl === np.avatarUrl &&
          p.isHost === np.isHost &&
          p.isOnline === np.isOnline
        );
      });

    if (!isSame) {
      useAppStore.getState().setParticipants(newParticipants);
    }

    if (useAppStore.getState().session.listenerCount !== listenerCount) {
      useAppStore.getState().setListenerCount(listenerCount);
    }
  }

  /**
   * Broadcast host mute action to all listeners in real-time
   */
  broadcastHostMute(isMuted: boolean) {
    if (this.presenceChannel) {
      // Send instant Realtime broadcast action event
      this.presenceChannel.send({
        type: 'broadcast',
        event: 'host_mute_action',
        payload: { isMuted, timestamp: Date.now() },
      }).then(null, () => {});
    }
  }

  /**
   * Kick a listener from the current live session.
   * Disconnects the listener in real-time and prevents them from rejoining this session.
   */
  kickListener(targetUserId: string, targetName?: string) {
    const activeSessionId = this.currentSessionId || useAppStore.getState().session.id;
    if (!activeSessionId || !targetUserId) return;

    this.kickedUserIds.add(targetUserId);
    this.dbListeners.delete(targetUserId);

    if (this.presenceChannel) {
      this.presenceChannel.send({
        type: 'broadcast',
        event: 'kick_listener',
        payload: {
          targetUserId,
          targetName,
          sessionId: activeSessionId,
          timestamp: Date.now(),
        },
      }).then(null, (err) => {
        console.warn('[PresenceManager] Error broadcasting kick event:', err);
      });
    }

    this.mergeAndPublishPresence();
  }

  /**
   * Permanently ban a listener from all sessions.
   */
  banListener(targetUserId: string, targetName?: string, targetAvatarUrl?: string, targetRole?: 'USER' | 'HOST' | 'ADMIN') {
    if (!targetUserId) return;
    const activeSessionId = this.currentSessionId || useAppStore.getState().session.id;
    const bannedItem: BannedUser = {
      id: targetUserId,
      name: targetName || 'Listener',
      avatarUrl: targetAvatarUrl,
      bannedAt: new Date().toISOString(),
      role: targetRole,
    };
    this.bannedUsers.set(targetUserId, bannedItem);
    this.kickedUserIds.add(targetUserId);
    this.dbListeners.delete(targetUserId);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tariqah_banned_users', JSON.stringify(Array.from(this.bannedUsers.values())));
        if (activeSessionId) {
          const stored = sessionStorage.getItem(`host_kicked_users_${activeSessionId}`);
          if (stored) {
            const list = JSON.parse(stored);
            const filtered = list.filter((u: { id: string }) => u.id !== targetUserId);
            sessionStorage.setItem(`host_kicked_users_${activeSessionId}`, JSON.stringify(filtered));
          }
        }
      } catch (e) {}
    }

    if (this.presenceChannel) {
      this.presenceChannel.send({
        type: 'broadcast',
        event: 'ban_listener',
        payload: {
          targetUserId,
          targetName,
          permanent: true,
          sessionId: activeSessionId,
          timestamp: Date.now(),
        },
      }).then(null, (err) => {
        console.warn('[PresenceManager] Error broadcasting ban event:', err);
      });
    } else if (activeSessionId) {
      const ch = supabase.channel(`session:presence:${activeSessionId}`);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'ban_listener',
            payload: {
              targetUserId,
              targetName,
              permanent: true,
              sessionId: activeSessionId,
              timestamp: Date.now(),
            },
          }).then(() => {
            supabase.removeChannel(ch).catch(() => {});
          });
        }
      });
    }

    // Always broadcast to dedicated target user channel so listener receives it regardless of active session
    const targetBanChannel = supabase.channel(`moderation:user:${targetUserId}`);
    targetBanChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetBanChannel.send({
          type: 'broadcast',
          event: 'ban_listener',
          payload: {
            targetUserId,
            targetName,
            permanent: true,
            sessionId: activeSessionId,
            timestamp: Date.now(),
          },
        }).then(() => {
          setTimeout(() => supabase.removeChannel(targetBanChannel).catch(() => {}), 1500);
        });
      }
    });

    this.mergeAndPublishPresence();
  }

  /**
   * Unban a listener, restoring their access across all sessions.
   */
  unbanListener(targetUserId: string) {
    if (!targetUserId) return;
    const activeSessionId = this.currentSessionId || useAppStore.getState().session.id;
    this.bannedUsers.delete(targetUserId);
    this.kickedUserIds.delete(targetUserId);

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tariqah_banned_users', JSON.stringify(Array.from(this.bannedUsers.values())));
        if (activeSessionId) {
          const stored = sessionStorage.getItem(`host_kicked_users_${activeSessionId}`);
          if (stored) {
            const list = JSON.parse(stored);
            const filtered = list.filter((u: { id: string }) => u.id !== targetUserId);
            sessionStorage.setItem(`host_kicked_users_${activeSessionId}`, JSON.stringify(filtered));
          }
        }
      } catch (e) {}
    }

    if (this.presenceChannel) {
      this.presenceChannel.send({
        type: 'broadcast',
        event: 'unban_listener',
        payload: {
          targetUserId,
          sessionId: activeSessionId,
          timestamp: Date.now(),
        },
      }).then(null, (err) => {
        console.warn('[PresenceManager] Error broadcasting unban event:', err);
      });
    } else if (activeSessionId) {
      const ch = supabase.channel(`session:presence:${activeSessionId}`);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'unban_listener',
            payload: {
              targetUserId,
              sessionId: activeSessionId,
              timestamp: Date.now(),
            },
          }).then(() => {
            supabase.removeChannel(ch).catch(() => {});
          });
        }
      });
    }

    // Always broadcast to dedicated target user channel so listener receives it EVEN IF HOST IS OFFLINE
    const targetUnbanChannel = supabase.channel(`moderation:user:${targetUserId}`);
    targetUnbanChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetUnbanChannel.send({
          type: 'broadcast',
          event: 'unban_listener',
          payload: {
            targetUserId,
            sessionId: activeSessionId,
            timestamp: Date.now(),
          },
        }).then(() => {
          setTimeout(() => supabase.removeChannel(targetUnbanChannel).catch(() => {}), 1500);
        });
      }
    });

    this.mergeAndPublishPresence();
  }

  getBannedUsers(): BannedUser[] {
    return Array.from(this.bannedUsers.values());
  }

  isUserBanned(userId: string): boolean {
    return this.bannedUsers.has(userId);
  }

  isUserKicked(userId: string): boolean {
    return this.kickedUserIds.has(userId);
  }

  syncKickedUserIds(ids: string[]) {
    this.kickedUserIds = new Set(ids);
  }

  addRejoinRequestListener(cb: (payload: { userId: string; userName: string; sessionId?: string }) => void): () => void {
    this.rejoinRequestListeners.add(cb);
    return () => this.rejoinRequestListeners.delete(cb);
  }

  /**
   * Un-kick a listener, allowing them to rejoin the live session
   */
  unkickListener(targetUserId: string) {
    const activeSessionId = this.currentSessionId || useAppStore.getState().session.id;
    if (!activeSessionId || !targetUserId) return;
    this.kickedUserIds.delete(targetUserId);

    if (typeof window !== 'undefined' && activeSessionId) {
      try {
        const stored = sessionStorage.getItem(`host_kicked_users_${activeSessionId}`);
        if (stored) {
          const list = JSON.parse(stored);
          const filtered = list.filter((u: { id: string }) => u.id !== targetUserId);
          sessionStorage.setItem(`host_kicked_users_${activeSessionId}`, JSON.stringify(filtered));
        }
      } catch (e) {}
    }

    if (this.presenceChannel) {
      this.presenceChannel.send({
        type: 'broadcast',
        event: 'unkick_listener',
        payload: {
          targetUserId,
          sessionId: activeSessionId,
          timestamp: Date.now(),
        },
      }).then(null, (err) => {
        console.warn('[PresenceManager] Error broadcasting unkick event:', err);
      });
    } else if (activeSessionId) {
      const ch = supabase.channel(`session:presence:${activeSessionId}`);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'unkick_listener',
            payload: {
              targetUserId,
              sessionId: activeSessionId,
              timestamp: Date.now(),
            },
          }).then(() => {
            supabase.removeChannel(ch).catch(() => {});
          });
        }
      });
    }

    // Always broadcast to dedicated target user channel so listener receives unkick immediately
    const targetUnkickChannel = supabase.channel(`moderation:user:${targetUserId}`);
    targetUnkickChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetUnkickChannel.send({
          type: 'broadcast',
          event: 'unkick_listener',
          payload: {
            targetUserId,
            sessionId: activeSessionId,
            timestamp: Date.now(),
          },
        }).then(() => {
          setTimeout(() => supabase.removeChannel(targetUnkickChannel).catch(() => {}), 1500);
        });
      }
    });

    this.mergeAndPublishPresence();
  }

  /**
   * Subscribe to session Realtime presence channel to track participants & listener count.
   */
  subscribeSessionPresence(sessionId: string, user: PresenceUser) {
    if (!sessionId || !user?.id) return;

    this.currentUser = user;

    if (this.currentSessionId !== sessionId) {
      this.kickedUserIds.clear();
    }

    // If already actively subscribed to this exact session on the same channel
    if (this.currentSessionId === sessionId && this.presenceChannel && (this.presenceChannel as unknown as { state?: string }).state === 'joined') {
      // Re-track to ensure latest presence state
      this.presenceChannel.track({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isHost: Boolean(user.isHost),
        joinedAt: new Date().toISOString(),
      }).catch(() => {});
      return;
    }

    this.currentSessionId = sessionId;

    // Teardown existing channel cleanly if active on previous session
    if (this.presenceChannel) {
      const oldChannel = this.presenceChannel;
      this.presenceChannel = null;
      oldChannel.untrack().catch(() => {});
      supabase.removeChannel(oldChannel).catch(() => {});
    }

    // Connect to Supabase Realtime channel with unique presence key and guaranteed broadcast ack
    const channelName = `session:presence:${sessionId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { ack: true, self: false },
        presence: { key: user.id },
      },
    });
    this.presenceChannel = channel;

    const handleSync = () => {
      if (this.getIsHost() && this.presenceChannel && (this.kickedUserIds.size > 0 || this.bannedUsers.size > 0)) {
        const presenceState = this.presenceChannel.presenceState();
        Object.values(presenceState).forEach((presences) => {
          presences.forEach((p: unknown) => {
            const item = p as { id?: string };
            if (item?.id && this.bannedUsers.has(item.id)) {
              this.presenceChannel?.send({
                type: 'broadcast',
                event: 'ban_listener',
                payload: { targetUserId: item.id, permanent: true, sessionId: this.currentSessionId },
              }).catch(() => {});
            } else if (item?.id && this.kickedUserIds.has(item.id)) {
              this.presenceChannel?.send({
                type: 'broadcast',
                event: 'kick_listener',
                payload: { targetUserId: item.id, sessionId: this.currentSessionId },
              }).catch(() => {});
            }
          });
        });
      }
      this.mergeAndPublishPresence();
    };

    channel
      .on('presence', { event: 'sync' }, handleSync)
      .on('presence', { event: 'join' }, handleSync)
      .on('presence', { event: 'leave' }, handleSync)
      .on('broadcast', { event: 'host_mute_action' }, ({ payload }) => {
        // Only listeners update their UI from host_mute_action broadcast (Host is master of its own local state)
        if (!this.getIsHost() && typeof payload?.isMuted === 'boolean') {
          console.log('[PresenceManager] Listener received host_mute_action broadcast:', payload.isMuted);
          useAppStore.getState().updateSession({ isHostMuted: payload.isMuted });
        }
      })
      .on('broadcast', { event: 'query_mute_state' }, () => {
        // When a new listener joins and asks for host mute state, host replies with current state
        if (this.getIsHost()) {
          const currentMuted = Boolean(useAppStore.getState().session.isHostMuted);
          this.broadcastHostMute(currentMuted);
        }
      })
      .on('broadcast', { event: 'kick_listener' }, ({ payload }) => {
        if (!this.getIsHost() && payload?.targetUserId === this.currentUser?.id) {
          console.warn('[PresenceManager] Listener received kick broadcast from host. Ejecting live session.');
          if (payload?.sessionId && this.currentUser?.id && typeof window !== 'undefined') {
            try {
              sessionStorage.setItem(`kicked_${payload.sessionId}_${this.currentUser.id}`, 'true');
              localStorage.removeItem(`kicked_session_${payload.sessionId}`);
            } catch (storageErr) {}
          }
          this.leavePresence();
          useAppStore.getState().updateSession({ isKicked: true });
          useAppStore.getState().setView('listener-preview');
        }
      })
      .on('broadcast', { event: 'unkick_listener' }, ({ payload }) => {
        if (!this.getIsHost() && payload?.targetUserId === this.currentUser?.id) {
          console.log('[PresenceManager] Host allowed rejoin. Clearing kick status.');
          if (payload?.sessionId && this.currentUser?.id && typeof window !== 'undefined') {
            try {
              sessionStorage.removeItem(`kicked_${payload.sessionId}_${this.currentUser.id}`);
              localStorage.removeItem(`kicked_session_${payload.sessionId}`);
            } catch (storageErr) {}
          }
          useAppStore.getState().updateSession({ isKicked: false });
        }
      })
      .on('broadcast', { event: 'ban_listener' }, ({ payload }) => {
        if (!this.getIsHost() && payload?.targetUserId === this.currentUser?.id) {
          console.warn('[PresenceManager] Listener received BAN broadcast from host. Ejecting live session.');
          this.leavePresence();
          useAppStore.getState().updateSession({ isKicked: true, isBanned: true });
          useAppStore.getState().setView('listener-preview');
        }
      })
      .on('broadcast', { event: 'unban_listener' }, ({ payload }) => {
        if (!this.getIsHost() && payload?.targetUserId === this.currentUser?.id) {
          console.log('[PresenceManager] Host lifted BAN.');
          if (this.currentUser?.id && typeof window !== 'undefined') {
            try {
              localStorage.removeItem(`tariqah_banned_${this.currentUser.id}`);
            } catch (storageErr) {}
          }
          useAppStore.getState().updateSession({ isKicked: false, isBanned: false });
        }
      })
      .on('broadcast', { event: 'moderation_status_query' }, ({ payload }) => {
        if (this.getIsHost() && payload?.targetUserId) {
          const isBanned = this.bannedUsers.has(payload.targetUserId);
          const isKicked = this.kickedUserIds.has(payload.targetUserId);
          const activeSessionId = this.currentSessionId || useAppStore.getState().session.id;
          console.log(`[PresenceManager] Host answering moderation query for ${payload.targetUserId}: banned=${isBanned}, kicked=${isKicked}`);
          this.presenceChannel?.send({
            type: 'broadcast',
            event: 'moderation_status_response',
            payload: {
              targetUserId: payload.targetUserId,
              isBanned,
              isKicked,
              sessionId: activeSessionId,
              timestamp: Date.now(),
            },
          }).catch((err) => {
            console.warn('[PresenceManager] Error sending moderation status response:', err);
          });
        }
      })
      .on('broadcast', { event: 'request_rejoin' }, ({ payload }) => {
        if (this.getIsHost() && payload?.userId) {
          console.log(`[PresenceManager] Received rejoin request from ${payload.userName} (${payload.userId})`);
          this.rejoinRequestListeners.forEach((cb) => {
            try { cb(payload); } catch (e) {}
          });
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              id: user.id,
              name: user.name,
              avatarUrl: user.avatarUrl,
              isHost: Boolean(user.isHost),
              joinedAt: new Date().toISOString(),
            });
            this.mergeAndPublishPresence();

            // If listener, ask host for current mute state
            if (!user.isHost) {
              channel.send({
                type: 'broadcast',
                event: 'query_mute_state',
                payload: {},
              }).then(null, () => {});
            }
          } catch (trackErr) {
            console.warn('[PresenceManager] Presence track error:', trackErr);
          }
        }
      });

    // Start appropriate heartbeat lease loops & fallback sync
    if (user.isHost) {
      this.startHostLeaseLoop(sessionId);
    } else {
      this.startListenerLeaseLoop(sessionId);
    }
    this.startFallbackSync(sessionId);
  }

  leavePresence() {
    const activeSessionId = this.currentSessionId;
    const isHost = this.getIsHost();
    this.stopHostLeaseLoop();
    this.stopListenerLeaseLoop();
    this.stopFallbackSync();
    this.currentSessionId = null;
    this.currentUser = null;
    this.dbListeners.clear();

    if (isHost) {
      this.kickedUserIds.clear();
      if (activeSessionId && typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem(`host_kicked_users_${activeSessionId}`);
        } catch (e) {}
      }
    }

    if (activeSessionId) {
      supabase.rpc('leave_listener_lease', { p_session_id: activeSessionId }).then(null, () => {});
    }

    if (this.presenceChannel) {
      const channelToLeave = this.presenceChannel;
      this.presenceChannel = null;
      channelToLeave.untrack().catch(() => {});
      supabase.removeChannel(channelToLeave).catch(() => {});
    }

    useAppStore.getState().setParticipants([]);
    useAppStore.getState().setListenerCount(0);
  }

  cleanup() {
    this.leavePresence();
  }
}

export const presenceManager = new PresenceManager();

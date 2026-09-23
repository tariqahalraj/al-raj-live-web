import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Headphones, Users, Clock, Loader2, RefreshCw, X, AlertCircle, ShieldBan } from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { formatDuration } from '@/shared/utils/format';
import { webRtcSessionManager } from '@/features/media-transport';
import { presenceManager, recoveryCoordinator } from '@/features/live-session';
import { supabase } from '@/core/supabase-client';
import { getInitials } from '@/features/live-session/participants-data';
import { EditProfileModal } from '@/features/profile/EditProfileModal';
import { startNativeLiveMonitoring } from '@/features/live-session/live-background-service';
import { getAssetUrl } from '@/shared/utils/asset';

export const ListenerPreviewScreen: React.FC = () => {
  const { setView, session, user, updateSession, setUser } = useAppStore();
  const [isJoining, setIsJoining] = useState(false);
  const [isRequestingRejoin, setIsRequestingRejoin] = useState(false);
  const [hasLiveSession, setHasLiveSession] = useState(false);
  const [rejoinNotice, setRejoinNotice] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Persistent ban and unban notification state
  const [isBanned, setIsBanned] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const userKey = user?.id ? localStorage.getItem(`tariqah_user_is_banned_${user.id}`) : null;
      const genericBan = localStorage.getItem('tariqah_user_is_banned') === 'true';
      return userKey === 'true' || genericBan || Boolean(useAppStore.getState().session.isBanned);
    }
    return Boolean(useAppStore.getState().session.isBanned);
  });
  const [showUnbannedNotice, setShowUnbannedNotice] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tariqah_congrats_unbanned') === 'true';
    }
    return false;
  });
  const [wasUnbannedWhileLive, setWasUnbannedWhileLive] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('tariqah_unbanned_rejoin_needed') === 'true';
    }
    return false;
  });
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  const previousStateRef = useRef<string | null>(null);
  const previewChannelRef = useRef<RealtimeChannel | null>(null);
  const activeChannelSessionIdRef = useRef<string | null>(null);

  const isHost = user?.role === 'HOST' || user?.role === 'ADMIN';

  // Strict role and auth guards
  useEffect(() => {
    if (!user) {
      setView('sign-in');
      return;
    }
    if (isHost) {
      setView('host-prelive');
    }
  }, [user, isHost, setView]);

  // Reset avatar load error if user's avatarUrl changes
  useEffect(() => {
    setAvatarLoadError(false);
  }, [user?.avatarUrl]);

  // Ensure current user's profile and avatar are fetched fresh from database
  useEffect(() => {
    if (!user?.id) return;
    let isCancelled = false;

    const fetchUserProfile = async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle();

        if (!isCancelled && profile && (profile.avatar_url !== user.avatarUrl || profile.full_name !== user.fullName)) {
          setUser({
            ...user,
            avatarUrl: profile.avatar_url || user.avatarUrl,
            fullName: profile.full_name || user.fullName,
          });
        }
      } catch (e) {
        console.warn('[ListenerPreview] Profile refresh notice:', e);
      }
    };

    fetchUserProfile();

    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  // Request native browser notification permission if available
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Fetch current active live session from Supabase silently without blinking the UI
  const loadActiveSession = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('live_sessions')
        .select('id, title, host_id, state, media_generation, cloudflare_session_id, cloudflare_track_id, created_at, started_at')
        .eq('state', 'LIVE')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('[ListenerPreview] Error querying active live session:', error.message);
        setHasLiveSession(false);
        return;
      }

      if (data) {
        const stateNow = useAppStore.getState();
        let hostName = 'Our Murshid';
        let hostAvatarUrl: string | undefined = getAssetUrl('assets/host-avatar.jpg');

        if (data.host_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', data.host_id)
            .maybeSingle();

          if (profile) {
            hostName = profile.full_name || 'Our Murshid';
            if (profile.avatar_url) {
              hostAvatarUrl = profile.avatar_url;
            }
          }
        }

        const startedAt = data.started_at ? new Date(data.started_at).getTime() : Date.now();
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

        // Clean up any stale session-storage kick keys from other sessions
        if (typeof window !== 'undefined' && stateNow.user?.id) {
          try {
            const currentKickKey = `kicked_${data.id}_${stateNow.user.id}`;
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
              const k = sessionStorage.key(i);
              if (k && k.startsWith('kicked_') && k !== currentKickKey) {
                sessionStorage.removeItem(k);
              }
            }
          } catch (e) {}
        }

        // Only update session in store if key data changed to avoid re-rendering loops
        const prev = stateNow.session;
        if (
          prev.id !== data.id ||
          prev.state !== 'LIVE' ||
          prev.title !== (data.title || 'Zikr Session') ||
          prev.mediaGeneration !== data.media_generation ||
          prev.cloudflareSessionId !== data.cloudflare_session_id ||
          prev.cloudflareTrackId !== data.cloudflare_track_id
        ) {
          updateSession({
            id: data.id,
            title: data.title || 'Zikr Session',
            hostName,
            hostAvatarUrl,
            state: 'LIVE',
            mediaGeneration: data.media_generation,
            elapsedSeconds,
            cloudflareSessionId: data.cloudflare_session_id,
            cloudflareTrackId: data.cloudflare_track_id,
          });
        }

        if (previousStateRef.current !== 'LIVE') {
          previousStateRef.current = 'LIVE';
        }
        setHasLiveSession(true);
      } else {
        const stateNow = useAppStore.getState();
        if (stateNow.session.state !== 'ENDED') {
          updateSession({ state: 'ENDED', id: '', isKicked: false, elapsedSeconds: 0 });
        }
        setHasLiveSession(false);
        previousStateRef.current = 'ENDED';
      }
    } catch (err) {
      console.warn('[ListenerPreview] Failed to load active live session:', err);
      setHasLiveSession(false);
    }
  }, [updateSession]);

  useEffect(() => {
    startNativeLiveMonitoring();
    loadActiveSession();

    const pollTimer = setInterval(loadActiveSession, 4000);

    const channel = supabase
      .channel('public:live_sessions_listener')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_sessions' },
        () => {
          loadActiveSession();
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollTimer);
      channel.unsubscribe();
    };
  }, [loadActiveSession]);

  // Check if host unbanned user in local storage
  useEffect(() => {
    if (typeof window !== 'undefined' && user?.id && isBanned) {
      try {
        const raw = localStorage.getItem('tariqah_banned_users');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list) && !list.some((u: { id: string }) => u.id === user.id)) {
            localStorage.removeItem('tariqah_user_is_banned');
            localStorage.removeItem(`tariqah_user_is_banned_${user.id}`);
            setIsBanned(false);
            const liveNow = useAppStore.getState().session.state === 'LIVE';
            if (!liveNow) {
              localStorage.setItem('tariqah_congrats_unbanned', 'true');
              setShowUnbannedNotice(true);
            } else {
              setWasUnbannedWhileLive(true);
              sessionStorage.setItem('tariqah_unbanned_rejoin_needed', 'true');
              setRejoinNotice('Our Murshid has unbanned your account. Tap "Request to Rejoin" to connect.');
            }
          }
        }
      } catch (e) {}
    }
  }, [user?.id, isBanned]);

  // Persistent targeted user moderation channel (listens even when host is offline)
  useEffect(() => {
    if (!user?.id) return;

    const channelName = `moderation:user:${user.id}`;
    const userModChannel = supabase.channel(channelName, {
      config: { broadcast: { ack: true, self: false } },
    });

    userModChannel
      .on('broadcast', { event: 'ban_listener' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.warn('[ListenerPreview] Targeted ban received via user channel.');
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('tariqah_user_is_banned', 'true');
              localStorage.setItem(`tariqah_user_is_banned_${user.id}`, 'true');
              localStorage.removeItem('tariqah_congrats_unbanned');
              sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
            } catch (e) {}
          }
          setIsBanned(true);
          setShowUnbannedNotice(false);
          setWasUnbannedWhileLive(false);
          updateSession({ isBanned: true, isKicked: true });
        }
      })
      .on('broadcast', { event: 'unban_listener' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.log('[ListenerPreview] Targeted unban received via user channel.');
          if (typeof window !== 'undefined') {
            try {
              localStorage.removeItem('tariqah_user_is_banned');
              localStorage.removeItem(`tariqah_user_is_banned_${user.id}`);
            } catch (e) {}
          }
          setIsBanned(false);
          updateSession({ isBanned: false, isKicked: false });

          const liveNow = useAppStore.getState().session.state === 'LIVE';
          if (!liveNow) {
            // Host is offline: show "congratulations you are unbanned"
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('tariqah_congrats_unbanned', 'true');
                sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
              } catch (e) {}
            }
            setShowUnbannedNotice(true);
            setWasUnbannedWhileLive(false);
          } else {
            // Host is online: show request to rejoin
            if (typeof window !== 'undefined') {
              try {
                sessionStorage.setItem('tariqah_unbanned_rejoin_needed', 'true');
                localStorage.removeItem('tariqah_congrats_unbanned');
              } catch (e) {}
            }
            setWasUnbannedWhileLive(true);
            setShowUnbannedNotice(false);
            setRejoinNotice('Our Murshid has unbanned your account. Tap "Request to Rejoin" to connect.');
          }
        }
      })
      .on('broadcast', { event: 'unkick_listener' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.log('[ListenerPreview] Targeted unkick received via user channel.');
          if (typeof window !== 'undefined') {
            try {
              if (session.id) sessionStorage.removeItem(`kicked_${session.id}_${user.id}`);
              sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
            } catch (e) {}
          }
          setWasUnbannedWhileLive(false);
          updateSession({ isKicked: false });
          setRejoinNotice('Our Murshid allowed you to rejoin! Connecting...');
          setTimeout(() => {
            setRejoinNotice(null);
            handleJoin();
          }, 600);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(userModChannel).catch(() => {});
    };
  }, [user?.id, session.id, updateSession]);

  // Active real-time moderation channel for preview/ejected listeners during live session
  useEffect(() => {
    if (!hasLiveSession || !session.id || !user?.id) {
      if (previewChannelRef.current) {
        supabase.removeChannel(previewChannelRef.current).catch(() => {});
        previewChannelRef.current = null;
        activeChannelSessionIdRef.current = null;
      }
      return;
    }

    if (activeChannelSessionIdRef.current === session.id && previewChannelRef.current) {
      return;
    }

    activeChannelSessionIdRef.current = session.id;

    if (previewChannelRef.current) {
      supabase.removeChannel(previewChannelRef.current).catch(() => {});
      previewChannelRef.current = null;
    }

    const channelName = `session:presence:${session.id}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { ack: true, self: false },
      },
    });

    previewChannelRef.current = channel;

    channel
      .on('broadcast', { event: 'unkick_listener' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.log('[ListenerPreview] Host allowed rejoin! Clearing kick status.');
          if (typeof window !== 'undefined') {
            try {
              sessionStorage.removeItem(`kicked_${session.id}_${user.id}`);
              sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
            } catch (e) {}
          }
          setWasUnbannedWhileLive(false);
          const curr = useAppStore.getState().session;
          if (curr.isKicked) {
            updateSession({ isKicked: false });
          }
          setRejoinNotice('Our Murshid allowed you to rejoin! Connecting...');
          setTimeout(() => {
            setRejoinNotice(null);
            handleJoin();
          }, 600);
        }
      })
      .on('broadcast', { event: 'unban_listener' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.log('[ListenerPreview] Host lifted ban! Updating state.');
          if (typeof window !== 'undefined') {
            try {
              sessionStorage.removeItem(`kicked_${session.id}_${user.id}`);
              localStorage.removeItem('tariqah_user_is_banned');
              localStorage.removeItem(`tariqah_user_is_banned_${user.id}`);
              sessionStorage.setItem('tariqah_unbanned_rejoin_needed', 'true');
              localStorage.removeItem('tariqah_congrats_unbanned');
            } catch (e) {}
          }
          setIsBanned(false);
          setShowUnbannedNotice(false);
          setWasUnbannedWhileLive(true);
          const curr = useAppStore.getState().session;
          if (curr.isBanned || curr.isKicked) {
            updateSession({ isBanned: false, isKicked: false });
          }
          setRejoinNotice('Our Murshid has unbanned your account. Tap "Request to Rejoin" to connect.');
        }
      })
      .on('broadcast', { event: 'ban_listener' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.warn('[ListenerPreview] Received ban broadcast from host.');
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('tariqah_user_is_banned', 'true');
              localStorage.setItem(`tariqah_user_is_banned_${user.id}`, 'true');
              localStorage.removeItem('tariqah_congrats_unbanned');
              sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
            } catch (e) {}
          }
          setIsBanned(true);
          setShowUnbannedNotice(false);
          setWasUnbannedWhileLive(false);
          const curr = useAppStore.getState().session;
          if (!curr.isBanned || !curr.isKicked) {
            updateSession({ isBanned: true, isKicked: true });
          }
        }
      })
      .on('broadcast', { event: 'moderation_status_response' }, ({ payload }) => {
        if (payload?.targetUserId === user.id) {
          console.log('[ListenerPreview] Moderation status response from host:', payload);
          if (payload.isBanned) {
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('tariqah_user_is_banned', 'true');
                localStorage.setItem(`tariqah_user_is_banned_${user.id}`, 'true');
                localStorage.removeItem('tariqah_congrats_unbanned');
                sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
              } catch (e) {}
            }
            setIsBanned(true);
            setShowUnbannedNotice(false);
            setWasUnbannedWhileLive(false);
            const curr = useAppStore.getState().session;
            if (!curr.isBanned || !curr.isKicked) {
              updateSession({ isBanned: true, isKicked: true });
            }
          } else {
            // Host confirmed user is NOT banned
            const wasBannedBefore = isBanned || (typeof window !== 'undefined' && (
              localStorage.getItem('tariqah_user_is_banned') === 'true' ||
              localStorage.getItem(`tariqah_user_is_banned_${user.id}`) === 'true'
            ));
            if (typeof window !== 'undefined') {
              try {
                localStorage.removeItem('tariqah_user_is_banned');
                localStorage.removeItem(`tariqah_user_is_banned_${user.id}`);
              } catch (e) {}
            }
            setIsBanned(false);

            if (wasBannedBefore) {
              // User was previously banned and is now confirmed unbanned!
              setWasUnbannedWhileLive(true);
              if (typeof window !== 'undefined') {
                try {
                  sessionStorage.setItem('tariqah_unbanned_rejoin_needed', 'true');
                  localStorage.removeItem('tariqah_congrats_unbanned');
                } catch (e) {}
              }
              setRejoinNotice('Our Murshid has unbanned your account. Tap "Request to Rejoin" to connect.');
            }

            const curr = useAppStore.getState().session;
            if (payload.isKicked) {
              if (typeof window !== 'undefined') {
                try {
                  sessionStorage.setItem(`kicked_${session.id}_${user.id}`, 'true');
                } catch (e) {}
              }
              if (!curr.isKicked) {
                updateSession({ isKicked: true, isBanned: false });
              }
            } else if (!wasBannedBefore) {
              if (typeof window !== 'undefined') {
                try {
                  sessionStorage.removeItem(`kicked_${session.id}_${user.id}`);
                  sessionStorage.removeItem('tariqah_unbanned_rejoin_needed');
                } catch (e) {}
              }
              setWasUnbannedWhileLive(false);
              if (curr.isBanned || curr.isKicked) {
                updateSession({ isBanned: false, isKicked: false });
              }
            }
          }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'moderation_status_query',
            payload: {
              targetUserId: user.id,
              sessionId: session.id,
            },
          }).catch(() => {});
        }
      });

    return () => {
      supabase.removeChannel(channel).catch(() => {});
      if (previewChannelRef.current === channel) {
        previewChannelRef.current = null;
        activeChannelSessionIdRef.current = null;
      }
    };
  }, [hasLiveSession, session.id, user?.id, updateSession, isBanned]);

  const isKickedFromCurrentSession = Boolean(
    !isBanned &&
    hasLiveSession &&
    session.id &&
    user?.id &&
    (
      session.isKicked ||
      wasUnbannedWhileLive ||
      (typeof window !== 'undefined' && sessionStorage.getItem(`kicked_${session.id}_${user.id}`) === 'true') ||
      (typeof window !== 'undefined' && sessionStorage.getItem('tariqah_unbanned_rejoin_needed') === 'true')
    )
  );

  const handleJoin = async () => {
    if (isJoining || isRequestingRejoin) return;

    if (isBanned) {
      alert('You are currently banned by the host from live broadcasts.');
      return;
    }

    if (isKickedFromCurrentSession) {
      setIsRequestingRejoin(true);
      if (previewChannelRef.current && session.id && user?.id) {
        previewChannelRef.current.send({
          type: 'broadcast',
          event: 'request_rejoin',
          payload: {
            userId: user.id,
            userName: user.fullName || 'Brother in Islam',
            sessionId: session.id,
          },
        }).catch(() => {});

        previewChannelRef.current.send({
          type: 'broadcast',
          event: 'moderation_status_query',
          payload: {
            targetUserId: user.id,
            sessionId: session.id,
          },
        }).catch(() => {});
      }
      setRejoinNotice('Requested permission to rejoin from Our Murshid. When the host taps "Allow Rejoin", you will be connected.');
      setTimeout(() => setIsRequestingRejoin(false), 2000);
      return;
    }

    setIsJoining(true);

    // Clean up any stale session-storage kick keys
    if (typeof window !== 'undefined' && session.id && user?.id) {
      try {
        sessionStorage.removeItem(`kicked_${session.id}_${user.id}`);
      } catch (e) {}
    }
    updateSession({ isKicked: false });

    // 1. Prime / unlock the audio element directly within the user click gesture
    webRtcSessionManager.unlockAudio();

    try {
      // 2. Fetch the latest live session details to guarantee fresh credentials
      const { data: activeLive } = await supabase
        .from('live_sessions')
        .select('id, cloudflare_session_id, cloudflare_track_id, media_generation, title')
        .eq('state', 'LIVE')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const activeSessionId = activeLive?.id || session.id;
      const cfSessionId = activeLive?.cloudflare_session_id || session.cloudflareSessionId;
      const cfTrackId = activeLive?.cloudflare_track_id || session.cloudflareTrackId;
      const mediaGen = activeLive?.media_generation || session.mediaGeneration || 1;

      if (activeLive) {
        updateSession({
          id: activeLive.id,
          title: activeLive.title || session.title,
          cloudflareSessionId: cfSessionId,
          cloudflareTrackId: cfTrackId,
          mediaGeneration: mediaGen,
          state: 'LIVE',
          isHostMuted: false,
        });
      }

      if (activeSessionId) {
        let effectiveUserId = user?.id;
        let effectiveName = user?.fullName || 'Brother in Islam';
        let effectiveAvatar = user?.avatarUrl;

        if (!effectiveUserId) {
          const { data: authData } = await supabase.auth.getSession();
          if (authData?.session?.user) {
            effectiveUserId = authData.session.user.id;
            effectiveName = (authData.session.user.user_metadata?.full_name as string) || 'Brother in Islam';
            effectiveAvatar = authData.session.user.user_metadata?.avatar_url as string;
          }
        }

        if (effectiveUserId) {
          presenceManager.subscribeSessionPresence(activeSessionId, {
            id: effectiveUserId,
            name: effectiveName,
            avatarUrl: effectiveAvatar,
            isHost: false,
          });
        }

        // Initialize recovery coordinator
        recoveryCoordinator.setSession(activeSessionId, false);
      }

      // 3. Navigate immediately to listener-live view
      setView('listener-live');

      // 4. Subscribe to Cloudflare host audio track
      if (activeSessionId && cfSessionId && cfTrackId) {
        console.log('[ListenerPreview] Subscribing to host audio track:', cfTrackId);
        webRtcSessionManager.subscribeHostAudio(
          activeSessionId,
          cfSessionId,
          cfTrackId,
          mediaGen
        ).catch((err) => {
          console.error('[ListenerPreview] WebRTC track subscription error:', err);
        });
      }
    } catch (err) {
      console.warn('[ListenerPreview] Join Live warning:', err);
      setView('listener-live');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="w-full flex flex-col min-h-screen bg-slate-50 md:bg-slate-100/60 justify-between overflow-y-auto">
      {/* Green Top Bar */}
      <div className="w-full bg-[#15803D] text-white px-4 md:px-8 lg:px-12 pt-safe pb-3 md:py-3.5 shrink-0 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          {/* Profile Icon Button on Top-Left */}
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-white/80 shadow-xs hover:ring-2 hover:ring-white/50 transition cursor-pointer shrink-0"
            title="Edit Profile"
            aria-label="Edit Profile"
          >
            {!avatarLoadError && user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName || 'User'}
                className="w-full h-full object-cover"
                onError={() => setAvatarLoadError(true)}
              />
            ) : (
              <div className="w-full h-full bg-emerald-800 text-white flex items-center justify-center font-bold text-sm">
                {getInitials(user?.fullName || user?.email || 'User')}
              </div>
            )}
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight leading-tight">
                Tariqah al-Raj
              </h1>
              <span className="hidden md:inline-flex items-center text-[10px] font-bold uppercase tracking-wider bg-white/20 text-white px-2 py-0.5 rounded-full border border-white/30">
                Live Audio
              </span>
            </div>
            <p className="text-xs text-emerald-100 font-medium">
              Spiritual Gathering Portal
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 md:px-8 py-6 my-auto w-full">
        <div className="w-full max-w-md md:max-w-2xl bg-transparent md:bg-white border-0 md:border md:border-slate-200/80 rounded-none md:rounded-3xl shadow-none md:shadow-md p-0 md:p-10 flex flex-col items-center text-center">
          {/* Unbanned Congratulations Notification Banner (Host Offline) */}
          {!isBanned && !hasLiveSession && showUnbannedNotice && (
            <div className="w-full mb-4 shrink-0 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="bg-[#15803D] text-white p-3.5 rounded-2xl shadow-lg border border-emerald-400/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0 text-base">
                    🎉
                  </div>
                  <div className="text-left">
                    <h4 className="text-xs font-bold text-white tracking-wide">
                      Congratulations, you are unbanned!
                    </h4>
                    <p className="text-[11px] text-emerald-100 mt-0.5">
                      Our Murshid has restored your access. You can join future live broadcasts.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowUnbannedNotice(false);
                    if (typeof window !== 'undefined') {
                      try {
                        localStorage.removeItem('tariqah_congrats_unbanned');
                      } catch (e) {}
                    }
                  }}
                  className="p-1.5 text-emerald-200 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer shrink-0"
                  aria-label="Dismiss notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Rejoin / Moderation Notice Banner */}
          {rejoinNotice && (
            <div className="w-full mb-4 shrink-0 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="bg-[#0F2942] text-white p-3 rounded-2xl shadow-lg border border-amber-500/40 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                  <p className="text-xs font-semibold text-white">{rejoinNotice}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRejoinNotice(null)}
                  className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                  aria-label="Dismiss notice"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}


          {/* Center Graphic */}
          <div className="w-48 h-48 md:w-56 md:h-56 relative flex items-center justify-center mx-auto my-3 shrink-0">
            <div className={`absolute w-44 h-44 md:w-52 md:h-52 rounded-full ${isBanned ? 'bg-rose-50' : 'bg-[#EAFBF3] animate-pulse-ring'}`} />
            <div className={`absolute w-36 h-36 md:w-42 md:h-42 rounded-full ${isBanned ? 'bg-rose-100' : 'bg-[#D1F7E4]'}`} />
            <div className={`relative z-10 w-28 h-28 md:w-32 md:h-32 rounded-full flex items-center justify-center shadow-md ${isBanned ? 'bg-rose-600' : 'bg-[#15803D]'}`}>
              {isBanned ? (
                <ShieldBan className="w-12 h-12 md:w-14 md:h-14 text-white stroke-[2.2]" />
              ) : (
                <Headphones className="w-12 h-12 md:w-14 md:h-14 text-white stroke-[2.2]" />
              )}
            </div>
          </div>

          {isBanned ? (
            <>
              {/* Account Banned Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 mb-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <span className="text-xs font-bold text-rose-600 tracking-wider">
                  ACCOUNT BANNED
                </span>
              </div>

              <h2 className="text-2xl font-bold text-slate-900 mb-1">
                Account Banned
              </h2>
              <p className="text-sm font-medium text-slate-500 max-w-sm leading-relaxed mb-6">
                You have been banned by the host from live broadcasts.
              </p>
            </>
          ) : hasLiveSession ? (
            <>
              {/* Live Indicator Pill */}
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-red-50 border border-red-200 mb-2">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                <span className="text-xs font-bold text-red-600 tracking-wider">
                  LIVE NOW
                </span>
              </div>

              <h2 className="text-2xl md:text-3xl font-extrabold text-[#0F2942] mb-1">
                {session.title || 'Zikr Session'}
              </h2>
              <p className="text-sm font-medium text-slate-500 mb-4">
                Conducted by {session.hostName || 'Our Murshid'}
              </p>

              {/* Metadata Row */}
              <div className="flex items-center justify-center gap-4 text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-5 py-2.5 mb-6">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-semibold">{session.listenerCount} Listening</span>
                </div>
                <span className="text-slate-300 font-light">|</span>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-semibold font-mono">
                    {formatDuration(session.elapsedSeconds)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl md:text-3xl font-bold text-[#0F2942] mb-1.5">
                Tariqah al-Raj Live
              </h2>
              <p className="text-sm text-slate-500 max-w-sm leading-relaxed mb-6">
                Waiting for broadcast. You will receive a notification here as soon as Our Murshid begins.
              </p>
            </>
          )}

          {/* Action CTA Button */}
          <div className="w-full max-w-md">
            {/* Styles for Animated Headphone Icon Interaction */}
            <style>{`
              @keyframes audioWaveExpand {
                0% {
                  transform: scale(0.85);
                  opacity: 0;
                }
                20% {
                  opacity: 0.85;
                }
                100% {
                  transform: scale(1.50);
                  opacity: 0;
                }
              }

              .join-btn-live {
                background-color: #0B6B46;
                box-shadow: 0 4px 12px rgba(11, 107, 70, 0.20);
                transition: background-color 0.15s ease, transform 0.1s ease;
              }

              .join-btn-live:hover:not(:disabled) {
                background-color: #10A06B;
              }

              .join-btn-live:active:not(:disabled) {
                background-color: #07543F;
                transform: scale(0.98);
              }

              .headphone-wave {
                pointer-events: none;
                overflow: visible;
                transform-origin: center center;
                will-change: transform, opacity;
              }

              .wave-1 {
                animation: audioWaveExpand 1.6s cubic-bezier(0.2, 0.7, 0.4, 1) 0s infinite;
              }

              .wave-2 {
                animation: audioWaveExpand 1.6s cubic-bezier(0.2, 0.7, 0.4, 1) 0.35s infinite;
              }

              .wave-3 {
                animation: audioWaveExpand 1.6s cubic-bezier(0.2, 0.7, 0.4, 1) 0.7s infinite;
              }

              @media (prefers-reduced-motion: reduce) {
                .headphone-wave {
                  animation: none !important;
                  opacity: 0 !important;
                  transform: none !important;
                }
              }
            `}</style>

            <button
              type="button"
              onClick={handleJoin}
              disabled={isJoining || isRequestingRejoin || !hasLiveSession || isBanned}
              className={`w-full py-4 px-6 font-bold rounded-2xl flex items-center justify-center gap-3 text-base tracking-wide transition duration-150 ${
                isBanned
                  ? 'bg-rose-50 text-rose-700 border border-rose-300 cursor-not-allowed shadow-none'
                  : isKickedFromCurrentSession
                  ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white cursor-pointer shadow-md'
                  : hasLiveSession
                  ? `join-btn-live text-white cursor-pointer ${isJoining ? 'opacity-95 cursor-wait' : ''}`
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none'
              } disabled:opacity-80`}
            >
              {isJoining ? (
                <>
                  <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                    <svg
                      viewBox="0 0 40 40"
                      className="headphone-wave wave-1 absolute inset-[-10px] w-10 h-10 fill-none stroke-white stroke-[1.8] [stroke-linecap:round]"
                      aria-hidden="true"
                    >
                      <path d="M 9.5 12.4 A 13 13 0 0 0 9.5 27.6" />
                      <path d="M 30.5 12.4 A 13 13 0 0 1 30.5 27.6" />
                    </svg>
                    <svg
                      viewBox="0 0 40 40"
                      className="headphone-wave wave-2 absolute inset-[-10px] w-10 h-10 fill-none stroke-white stroke-[1.8] [stroke-linecap:round]"
                      aria-hidden="true"
                    >
                      <path d="M 9.5 12.4 A 13 13 0 0 0 9.5 27.6" />
                      <path d="M 30.5 12.4 A 13 13 0 0 1 30.5 27.6" />
                    </svg>
                    <svg
                      viewBox="0 0 40 40"
                      className="headphone-wave wave-3 absolute inset-[-10px] w-10 h-10 fill-none stroke-white stroke-[1.6] [stroke-linecap:round]"
                      aria-hidden="true"
                    >
                      <path d="M 9.5 12.4 A 13 13 0 0 0 9.5 27.6" />
                      <path d="M 30.5 12.4 A 13 13 0 0 1 30.5 27.6" />
                    </svg>
                    <Headphones className="w-5 h-5 stroke-[2.4] relative z-10 text-white" />
                  </div>
                  <span>Joining…</span>
                </>
              ) : isRequestingRejoin ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Requesting Rejoin...</span>
                </>
              ) : isBanned ? (
                <>
                  <AlertCircle className="w-5 h-5 stroke-[2.4] text-rose-600" />
                  <span>You are Banned</span>
                </>
              ) : isKickedFromCurrentSession ? (
                <>
                  <RefreshCw className="w-5 h-5 stroke-[2.4]" />
                  <span>Request to Rejoin</span>
                </>
              ) : hasLiveSession ? (
                <>
                  <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                    <svg
                      viewBox="0 0 40 40"
                      className="headphone-wave wave-1 absolute inset-[-10px] w-10 h-10 fill-none stroke-white stroke-[1.8] [stroke-linecap:round]"
                      aria-hidden="true"
                    >
                      <path d="M 9.5 12.4 A 13 13 0 0 0 9.5 27.6" />
                      <path d="M 30.5 12.4 A 13 13 0 0 1 30.5 27.6" />
                    </svg>
                    <svg
                      viewBox="0 0 40 40"
                      className="headphone-wave wave-2 absolute inset-[-10px] w-10 h-10 fill-none stroke-white stroke-[1.8] [stroke-linecap:round]"
                      aria-hidden="true"
                    >
                      <path d="M 9.5 12.4 A 13 13 0 0 0 9.5 27.6" />
                      <path d="M 30.5 12.4 A 13 13 0 0 1 30.5 27.6" />
                    </svg>
                    <svg
                      viewBox="0 0 40 40"
                      className="headphone-wave wave-3 absolute inset-[-10px] w-10 h-10 fill-none stroke-white stroke-[1.6] [stroke-linecap:round]"
                      aria-hidden="true"
                    >
                      <path d="M 9.5 12.4 A 13 13 0 0 0 9.5 27.6" />
                      <path d="M 30.5 12.4 A 13 13 0 0 1 30.5 27.6" />
                    </svg>
                    <Headphones className="w-5 h-5 stroke-[2.4] relative z-10 text-white" />
                  </div>
                  <span>Join Live</span>
                </>
              ) : (
                <>
                  <Headphones className="w-5 h-5 stroke-[2.4]" />
                  <span>Waiting for Broadcast</span>
                </>
              )}
            </button>
            <p className="text-xs text-slate-500 text-center mt-3">
              {isBanned
                ? 'You have been banned by the host from live broadcasts.'
                : isKickedFromCurrentSession
                ? 'You were unbanned. Tap "Request to Rejoin" to notify Our Murshid.'
                : hasLiveSession
                ? 'Tap to join and listen to the current session.'
                : 'Live audio will begin automatically when the host starts.'}
            </p>
          </div>
        </div>

        {/* Edit Profile Modal */}
        <EditProfileModal
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
        />
      </div>
    </div>
  );
};

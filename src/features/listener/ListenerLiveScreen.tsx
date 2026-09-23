import React, { useEffect, useCallback, useState } from 'react';
import { ChevronLeft, MicOff, PhoneOff, Loader2, Volume2, Volume1, VolumeX } from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { getInitials } from '@/features/live-session/participants-data';
import { formatDuration } from '@/shared/utils/format';
import { webRtcSessionManager } from '@/features/media-transport';
import { presenceManager, recoveryCoordinator, startBackgroundLiveService, stopBackgroundLiveService } from '@/features/live-session';
import { supabase } from '@/core/supabase-client';
import { HostAvatarGlow } from './components';
import { getAssetUrl } from '@/shared/utils/asset';

export const ListenerLiveScreen: React.FC = () => {
  const { setView, session, user, participants, updateSession, isOnline } = useAppStore();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [volume, setVolume] = useState<number>(() => webRtcSessionManager.getVolume());
  const [isMuted, setIsMuted] = useState<boolean>(() => webRtcSessionManager.getVolume() === 0);
  const [lastNonZeroVolume, setLastNonZeroVolume] = useState<number>(1.0);

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (newVol > 0) {
      setLastNonZeroVolume(newVol);
    }
    webRtcSessionManager.setVolume(newVol);
    webRtcSessionManager.playRemoteAudio().catch(() => {});
  };

  const handleToggleMuteVolume = () => {
    if (!isMuted && volume > 0) {
      setLastNonZeroVolume(volume);
      setIsMuted(true);
      webRtcSessionManager.setVolume(0);
    } else {
      const restored = lastNonZeroVolume > 0 ? lastNonZeroVolume : 1.0;
      setVolume(restored);
      setIsMuted(false);
      webRtcSessionManager.setVolume(restored);
      webRtcSessionManager.playRemoteAudio().catch(() => {});
    }
  };

  // Cleanly exit to preview screen when session ends by host
  const exitEndedSession = useCallback(() => {
    console.log('[ListenerLiveScreen] Live session has ended. Cleaning up and exiting to preview.');
    stopBackgroundLiveService();
    webRtcSessionManager.teardown();
    presenceManager.leavePresence();
    recoveryCoordinator.cleanup();
    if (session.id && user?.id && typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(`kicked_${session.id}_${user.id}`);
        localStorage.removeItem(`kicked_session_${session.id}`);
      } catch (e) {}
    }
    updateSession({ state: 'ENDED', id: '', isKicked: false, elapsedSeconds: 0, cloudflareSessionId: undefined, cloudflareTrackId: undefined, isHostMuted: false });
    const isHost = user?.role === 'HOST' || user?.role === 'ADMIN';
    setView(isHost ? 'host-prelive' : 'listener-preview');
  }, [user, session.id, updateSession, setView]);

  // Cleanly exit when permanently banned by host
  const forceExitBanned = useCallback(() => {
    console.warn('[ListenerLiveScreen] Permanently banned by host.');
    stopBackgroundLiveService();
    webRtcSessionManager.teardown();
    presenceManager.leavePresence();
    recoveryCoordinator.cleanup();
    if (user?.id && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`tariqah_banned_${user.id}`);
      } catch (e) {}
    }
    updateSession({ isKicked: true, isBanned: true });
    setView('listener-preview');
  }, [user?.id, setView, updateSession]);

  // Cleanly exit when kicked by host
  const forceExitKicked = useCallback(() => {
    console.warn('[ListenerLiveScreen] Removed from broadcast by host.');
    stopBackgroundLiveService();
    webRtcSessionManager.teardown();
    presenceManager.leavePresence();
    recoveryCoordinator.cleanup();
    if (session.id && user?.id && typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(`kicked_${session.id}_${user.id}`, 'true');
        localStorage.removeItem(`kicked_session_${session.id}`);
      } catch (e) {}
    }
    updateSession({ isKicked: true });
    setView('listener-preview');
  }, [session.id, user?.id, setView, updateSession]);

  // Guard: if banned or kicked, immediately exit
  useEffect(() => {
    if (session.isBanned) {
      forceExitBanned();
      return;
    }

    const isKickedInStorage = session.id && user?.id && typeof window !== 'undefined'
      ? sessionStorage.getItem(`kicked_${session.id}_${user.id}`) === 'true'
      : false;

    if (session.isKicked || isKickedInStorage) {
      forceExitKicked();
    }
  }, [session.isBanned, session.isKicked, session.id, user?.id, forceExitKicked, forceExitBanned]);

  // Persistent Telegram-style foreground push service to keep audio running when minimized
  useEffect(() => {
    startBackgroundLiveService(session.title || 'Zikr Session', false);
    return () => {
      stopBackgroundLiveService();
    };
  }, [session.title]);

  // Ensure remote audio playback on mount & listen to reconnection state
  useEffect(() => {
    webRtcSessionManager.playRemoteAudio().catch(() => {});

    const unregister = webRtcSessionManager.addStatusListener((status) => {
      const reconnecting = status === 'reconnecting' || status === 'soft_recovery' || status === 'hard_reset';
      setIsReconnecting(reconnecting);
    });

    return unregister;
  }, []);

  // Ensure listener presence is active on mount and updates in real-time
  useEffect(() => {
    const initPresence = async () => {
      if (!session.id) return;
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
        presenceManager.subscribeSessionPresence(session.id, {
          id: effectiveUserId,
          name: effectiveName,
          avatarUrl: effectiveAvatar,
          isHost: false,
        });
      }
    };

    initPresence();

    return () => {
      // NOTE: Transient re-renders or background app switching should NEVER teardown presence.
      // Explicit session exits are cleanly handled by handleLeave() and exitEndedSession().
    };
  }, [session.id, user?.id]);

  // 1. Listen for Host Ending Live (Real-time Supabase postgres_changes + resilient fallback polling)
  useEffect(() => {
    const channel = supabase
      .channel(`listener_session_lifecycle_${session.id || 'live'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_sessions' },
        (payload) => {
          const newRecord = payload.new as { id?: string; state?: string };
          if (
            payload.eventType === 'DELETE' ||
            (newRecord && (newRecord.state === 'ENDED' || newRecord.state === 'FAILED'))
          ) {
            exitEndedSession();
          }
        }
      )
      .subscribe();

    // Resilient polling fallback: verify target session status every 3 seconds without false-alarm exits
    let consecutiveMisses = 0;
    const pollTimer = setInterval(async () => {
      if (!session.id) return;
      try {
        const { data: targetSession, error } = await supabase
          .from('live_sessions')
          .select('id, state')
          .eq('id', session.id)
          .maybeSingle();

        if (error) {
          // Network fluctuation / slow connection — DO NOT exit!
          console.warn('[ListenerLiveScreen] Periodic status check network notice:', error.message);
          return;
        }

        if (targetSession && (targetSession.state === 'ENDED' || targetSession.state === 'FAILED')) {
          console.log('[ListenerLiveScreen] Target session marked ENDED/FAILED in database.');
          exitEndedSession();
          return;
        }

        if (!targetSession) {
          consecutiveMisses += 1;
          if (consecutiveMisses >= 4) { // Only exit after 12 seconds of confirmed absence
            console.log('[ListenerLiveScreen] Target session no longer found after 4 checks.');
            exitEndedSession();
          }
        } else {
          consecutiveMisses = 0;
        }
      } catch (pollErr) {
        console.warn('[ListenerLiveScreen] Periodic status check notice:', pollErr);
      }
    }, 3000);

    return () => {
      channel.unsubscribe();
      clearInterval(pollTimer);
    };
  }, [session.id, exitEndedSession]);

  // 2. Network Recovery: When user turns data off then back on, auto-reconnect immediately
  useEffect(() => {
    const handleOnline = async () => {
      console.log('[ListenerLiveScreen] Network restored online! Reconnecting live stream...');
      try {
        const { data: live } = await supabase
          .from('live_sessions')
          .select('id, title, cloudflare_session_id, cloudflare_track_id, media_generation, state')
          .eq('state', 'LIVE')
          .limit(1)
          .maybeSingle();

        if (live?.cloudflare_session_id && live?.cloudflare_track_id) {
          updateSession({
            id: live.id,
            title: live.title || session.title,
            cloudflareSessionId: live.cloudflare_session_id,
            cloudflareTrackId: live.cloudflare_track_id,
            mediaGeneration: live.media_generation,
            state: 'LIVE',
          });

          await webRtcSessionManager.subscribeHostAudio(
            live.id,
            live.cloudflare_session_id,
            live.cloudflare_track_id,
            live.media_generation
          );
          await webRtcSessionManager.playRemoteAudio();
        } else {
          exitEndedSession();
        }
      } catch (err) {
        console.warn('[ListenerLiveScreen] Network restore reconnection error:', err);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [session.title, updateSession, exitEndedSession]);

  // One-time fallback: only if WebRTC is completely uninitialized on initial mount
  const hasSubscribedRef = React.useRef(false);
  useEffect(() => {
    if (hasSubscribedRef.current) return;
    const status = webRtcSessionManager.getStatus();
    if (status === 'idle' || status === 'closed') {
      hasSubscribedRef.current = true;
      const initSubscription = async () => {
        let cfSessionId = session.cloudflareSessionId;
        let cfTrackId = session.cloudflareTrackId;
        let sessId = session.id;
        let mediaGen = session.mediaGeneration || 1;

        if (!cfSessionId || !cfTrackId || !sessId) {
          try {
            const { data: live } = await supabase
              .from('live_sessions')
              .select('id, title, cloudflare_session_id, cloudflare_track_id, media_generation, state')
              .eq('state', 'LIVE')
              .order('started_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (live?.cloudflare_session_id && live?.cloudflare_track_id) {
              sessId = live.id;
              cfSessionId = live.cloudflare_session_id;
              cfTrackId = live.cloudflare_track_id;
              mediaGen = live.media_generation || 1;
              updateSession({
                id: live.id,
                title: live.title || session.title,
                cloudflareSessionId: live.cloudflare_session_id,
                cloudflareTrackId: live.cloudflare_track_id,
                mediaGeneration: live.media_generation,
                state: 'LIVE',
              });
            }
          } catch (err) {
            console.warn('[ListenerLiveScreen] Session resolution error:', err);
          }
        }

        if (sessId && cfSessionId && cfTrackId) {
          console.log('[ListenerLiveScreen] Initializing audio subscription on mount');
          webRtcSessionManager.subscribeHostAudio(
            sessId,
            cfSessionId,
            cfTrackId,
            mediaGen
          ).catch((err) => {
            console.warn('[ListenerLiveScreen] Initial subscription notice:', err);
          });
        }
      };
      initSubscription();
    }
  }, [session.id, session.cloudflareSessionId, session.cloudflareTrackId, session.mediaGeneration, session.title, updateSession]);

  // Configure background playback via MediaSession & WakeLock safely
  useEffect(() => {
    let wakeLockSentinel: unknown = null;
    try {
      if ('wakeLock' in navigator) {
        (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } })
          .wakeLock.request('screen')
          .then((wl) => {
            wakeLockSentinel = wl;
          })
          .catch(() => {});
      }
    } catch {}

    try {
      if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: session.title || 'Zikr Session',
          artist: session.hostName || 'Our Murshid',
          album: 'Tariqah al-Raj Live',
        });
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (err) {
      console.warn('[ListenerLiveScreen] MediaSession error ignored:', err);
    }

    return () => {
      try {
        if (wakeLockSentinel && typeof (wakeLockSentinel as { release: () => Promise<void> }).release === 'function') {
          (wakeLockSentinel as { release: () => Promise<void> }).release().catch(() => {});
        }
      } catch {}
      try {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'none';
        }
      } catch {}
    };
  }, [session.title, session.hostName]);

  const handleLeave = () => {
    if (window.confirm('Leave the current live session?')) {
      stopBackgroundLiveService();
      webRtcSessionManager.teardown();
      presenceManager.leavePresence();
      recoveryCoordinator.cleanup();
      updateSession({ isKicked: false });
      setView('listener-preview');
    }
  };

  const handleScreenClick = () => {
    webRtcSessionManager.playRemoteAudio().catch(() => {});
  };

  // Only real signed-in listeners
  const listeners = participants.filter((p) => !p.isHost);

  return (
    <div
      onClick={handleScreenClick}
      className="w-full flex flex-col min-h-screen bg-slate-50 md:bg-slate-100/60 justify-between select-none overflow-hidden"
    >
      {/* Green Top Bar */}
      <div className="w-full bg-[#15803D] text-white px-4 md:px-8 lg:px-12 pt-safe pb-2.5 md:py-3.5 shrink-0 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2 -ml-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleLeave();
            }}
            className="p-1.5 text-white hover:text-emerald-100 hover:bg-white/10 rounded-full transition cursor-pointer shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-lg md:text-xl font-bold text-white tracking-tight leading-tight">
              Tariqah al-Raj
            </h1>
            <p className="text-xs text-emerald-100 font-medium">
              {session.title || 'Live Broadcast'}
            </p>
          </div>
        </div>

        {/* Top Bar Right: Live Badge */}
        <div className="flex items-center gap-3">
          {/* Unified Live Badge + Elapsed Timer */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-600 text-white text-xs font-bold shadow-xs">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="tracking-wide">LIVE</span>
            <span className="text-white/60">·</span>
            <span className="font-mono font-medium">{formatDuration(session.elapsedSeconds)}</span>
          </div>
        </div>
      </div>

      {/* ================= DESKTOP 2-PANEL WEB PLAYER CONSOLE (>= md) ================= */}
      <div className="hidden md:flex flex-1 max-w-7xl mx-auto w-full p-6 lg:p-8 gap-6 overflow-hidden items-stretch">
        {/* Left Column: Host & Audio Controls */}
        <div className="w-80 lg:w-96 shrink-0 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 flex flex-col justify-between items-center text-center">
          <div className="flex flex-col items-center w-full">
            {/* Host Avatar with Warm Golden Audio-Reactive Glow */}
            <HostAvatarGlow
              avatarUrl={session.hostAvatarUrl}
              hostName={session.hostName || 'Host'}
              isOnline={true}
              isHostMuted={session.isHostMuted}
              className="my-3"
            />

            {/* Host Details & Session Title */}
            <h2 className="text-xl font-bold text-slate-900 mt-2 mb-0.5">
              {session.hostName || 'Host'}
            </h2>
            <p className="text-xs text-slate-500 mb-2">
              {session.title || 'Live Broadcast'}
            </p>
            <div className="mb-2">
              {session.isHostMuted ? (
                <span className="text-xs text-red-600 font-bold inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 border border-red-200 shadow-2xs">
                  <MicOff className="w-3.5 h-3.5 stroke-[2.2]" />
                  Host mic is muted
                </span>
              ) : (
                <span className="text-xs text-emerald-700 font-bold inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-[#15803D] animate-pulse" />
                  Broadcasting live
                </span>
              )}
            </div>
          </div>

          {/* Player Audio Control & Leave Button */}
          <div className="w-full space-y-3 pt-6 border-t border-slate-100">
            {/* Desktop Volume Slider */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full p-3.5 bg-slate-50 border border-slate-200/90 rounded-xl flex flex-col gap-2"
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-emerald-700" />
                  Volume
                </span>
                <span className="font-mono text-emerald-800">
                  {isMuted ? 'Muted' : `${Math.round(volume * 100)}%`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleToggleMuteVolume}
                  className="text-slate-600 hover:text-emerald-700 transition cursor-pointer p-0.5 shrink-0"
                  aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-slate-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4 text-[#15803D]" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-[#15803D]" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#15803D]"
                  aria-label="Volume Slider"
                />
              </div>
            </div>

            {/* Reconnecting Banner */}
            {(!isOnline || isReconnecting) && (
              <div className="inline-flex items-center justify-center gap-2 px-4 py-2 w-full rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                <span>{!isOnline ? 'Disconnected...' : 'Reconnecting audio...'}</span>
              </div>
            )}

            {/* Leave Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLeave();
              }}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold rounded-xl shadow-xs flex items-center justify-center gap-2 transition duration-150 cursor-pointer text-sm"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Leave Broadcast</span>
            </button>
          </div>
        </div>

        {/* Right Column: Listeners Roster */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 flex flex-col justify-between overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900">
              Listeners
            </h3>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
              {session.listenerCount} {session.listenerCount === 1 ? 'online' : 'online'}
            </span>
          </div>

          {/* Participants Grid */}
          <div className="flex-1 overflow-y-auto py-4">
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-y-4 gap-x-3">
              {/* Position 0: Host Tile */}
              <div className="flex flex-col items-center text-center p-1">
                <div className="relative w-12 h-12 mb-1.5 shrink-0">
                  <div className="w-full h-full rounded-full overflow-hidden border border-slate-200 bg-white shadow-2xs">
                    <img
                      src={session.hostAvatarUrl || getAssetUrl('assets/host-avatar.jpg')}
                      alt="Host"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = getAssetUrl('assets/app-logo.png');
                      }}
                    />
                  </div>
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full border border-white leading-tight shadow-2xs whitespace-nowrap z-10">
                    Host
                  </span>
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#10B981] border-2 border-white z-10" />
                </div>
                <span className="text-xs font-bold text-slate-900 truncate w-full">
                  {session.hostName || 'Host'}
                </span>
              </div>

              {/* Real Signed-In Listeners */}
              {listeners.map((listener) => (
                <div
                  key={listener.id}
                  className="flex flex-col items-center text-center p-1"
                >
                  <div className="relative w-12 h-12 mb-1.5 shrink-0">
                    {listener.avatarUrl ? (
                      <div className="w-full h-full rounded-full overflow-hidden border border-slate-200 bg-slate-100 shadow-2xs">
                        <img
                          src={listener.avatarUrl}
                          alt={listener.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-full rounded-full bg-emerald-100 text-[#15803D] flex items-center justify-center font-bold text-sm border border-emerald-200 shadow-2xs">
                        {getInitials(listener.name)}
                      </div>
                    )}
                    {listener.isOnline && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#10B981] border-2 border-white z-10" />
                    )}
                  </div>
                  <span className="text-xs font-semibold text-slate-800 truncate w-full">
                    {listener.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ================= MOBILE VIEW (< md) ================= */}
      <div className="w-full flex-1 flex flex-col justify-between px-5 pb-safe overflow-hidden md:hidden">
        {/* Center Section: Host Audio Representation (Clean & Elegant) */}
        <div className="flex flex-col items-center justify-center text-center my-2 shrink-0">
          {/* Host Avatar with Warm Golden Audio-Reactive Glow */}
          <HostAvatarGlow
            avatarUrl={session.hostAvatarUrl}
            hostName={session.hostName || 'Our Murshid'}
            isOnline={true}
            isHostMuted={session.isHostMuted}
            className="my-2"
          />

          {/* Live Status Header */}
          <div className="mt-1">
            {session.isHostMuted ? (
              <span className="text-xs font-bold text-red-600 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 border border-red-200 shadow-2xs">
                <MicOff className="w-3.5 h-3.5 stroke-[2.2]" />
                Host mic is muted
              </span>
            ) : (
              <span className="text-xs font-bold text-[#15803D] inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-[#15803D] animate-pulse" />
                Broadcasting Live
              </span>
            )}
          </div>

          {/* Interactive Volume Slider Control */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] mx-auto mt-2 px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-2xl flex items-center gap-2.5 shadow-2xs"
          >
            <button
              type="button"
              onClick={handleToggleMuteVolume}
              className="text-slate-600 hover:text-emerald-700 transition cursor-pointer p-0.5 shrink-0"
              aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-slate-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4 text-[#15803D]" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#15803D]" />
              )}
            </button>

            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#15803D]"
              aria-label="Volume Slider"
            />

            <span className="text-[11px] font-semibold text-slate-600 font-mono w-9 text-right select-none shrink-0">
              {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
            </span>
          </div>

          {/* Reconnecting Banner */}
          {(!isOnline || isReconnecting) && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
              <span>{!isOnline ? 'Disconnected...' : 'Reconnecting audio...'}</span>
            </div>
          )}
        </div>

        {/* Listeners Grid Section */}
        <div className="flex-1 overflow-y-auto px-1 pt-1 pb-2">
          {/* Listeners Header */}
          <div className="flex items-center justify-between mb-3 border-t border-slate-100 pt-2.5">
            <h3 className="text-sm font-bold text-slate-900">
              Listeners
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span className="w-2 h-2 rounded-full bg-[#15803D]" />
              <span>Online</span>
            </div>
          </div>

          {/* 4-Column Grid: First Item is Host with 'Host' badge, followed by listeners */}
          <div className="grid grid-cols-4 gap-y-3 gap-x-2 text-center">
            {/* Position 0: Host Tile with Non-Overlapping Badge */}
            <div className="flex flex-col items-center">
              <div className="relative w-[52px] h-[52px] mb-1.5 shrink-0">
                <div className="w-full h-full rounded-full overflow-hidden border border-slate-200 bg-slate-100 shadow-2xs">
                  <img
                    src={session.hostAvatarUrl || getAssetUrl('assets/host-avatar.jpg')}
                    alt="Our Murshid"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = getAssetUrl('assets/app-logo.png');
                    }}
                  />
                </div>
                {/* Host Red Badge below avatar */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full border border-white leading-tight shadow-2xs whitespace-nowrap z-10">
                  Host
                </span>
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#10B981] border-2 border-white z-10" />
              </div>
              <span className="text-[11px] font-bold text-[#0F2942] truncate w-full px-0.5 mt-0.5">
                {session.hostName || 'Our Murshid'}
              </span>
            </div>

            {/* Subsequent Positions: Real Signed-in Listeners */}
            {listeners.map((listener) => (
              <div key={listener.id} className="flex flex-col items-center">
                <div className="relative w-[52px] h-[52px] mb-1.5 shrink-0">
                  {listener.avatarUrl ? (
                    <div className="w-full h-full rounded-full overflow-hidden border border-slate-200 bg-slate-100 shadow-2xs">
                      <img
                        src={listener.avatarUrl}
                        alt={listener.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full rounded-full bg-emerald-100 text-[#15803D] flex items-center justify-center font-bold text-sm border border-emerald-200 shadow-2xs">
                      {getInitials(listener.name)}
                    </div>
                  )}
                  {listener.isOnline && (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#10B981] border-2 border-white z-10" />
                  )}
                </div>
                <span className="text-[11px] font-medium text-slate-800 truncate w-full px-0.5 mt-0.5">
                  {listener.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Floating Control Bar */}
        <div className="w-full pt-2.5 pb-2 border-t border-slate-100 bg-white shrink-0">
          <div className="flex items-center justify-center gap-12 max-w-xs mx-auto">
            {/* Muted Status Indicator */}
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 shadow-2xs">
                <MicOff className="w-6 h-6" />
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-1 leading-tight">
                You're listening<br />
                <span className="text-slate-400">Mic is off</span>
              </p>
            </div>

            {/* Leave Button */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLeave();
                }}
                className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white flex items-center justify-center shadow-md transition cursor-pointer"
                aria-label="Leave Live Session"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
              <span className="text-xs font-bold text-red-600 mt-1">
                Leave
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

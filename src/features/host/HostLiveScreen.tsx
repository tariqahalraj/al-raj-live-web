import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  Mic,
  MicOff,
  Square,
  Users,
  UserX,
  LayoutDashboard,
  ShieldBan,
  X,
  Zap,
  Leaf,
} from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { getInitials } from '@/features/live-session/participants-data';
import { formatDuration } from '@/shared/utils/format';
import { audioEngine, AudioReactiveMicPulse } from '@/features/audio-engine';
import { audioRecorder } from '@/features/audio-engine/audio-recorder';
import { recordingsManager } from '@/features/audio-engine/recordings-manager';
import { webRtcSessionManager } from '@/features/media-transport';
import { presenceManager, recoveryCoordinator, startBackgroundLiveService, stopBackgroundLiveService } from '@/features/live-session';
import { supabase } from '@/core/supabase-client';

export const HostLiveScreen: React.FC = () => {
  const {
    setView,
    setPreviousHostView,
    session,
    participants,
    toggleHostMute,
    endSession,
    user,
    updateSession,
    setTransmissionMode,
  } = useAppStore();

  const [targetKickUser, setTargetKickUser] = useState<{ id: string; name: string; avatarUrl?: string } | null>(null);
  const [kickedUsers, setKickedUsers] = useState<Array<{ id: string; name: string }>>(() => {
    if (typeof window !== 'undefined' && session.id) {
      try {
        const saved = sessionStorage.getItem(`host_kicked_users_${session.id}`);
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return [];
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pendingRejoin, setPendingRejoin] = useState<{ userId: string; userName: string } | null>(null);

  // Sync kicked user IDs to presenceManager
  useEffect(() => {
    presenceManager.syncKickedUserIds(kickedUsers.map((u) => u.id));
  }, [kickedUsers]);

  // Listen to listener rejoin requests
  useEffect(() => {
    const unregister = presenceManager.addRejoinRequestListener(({ userId, userName }) => {
      const listenerName = userName || 'A listener';
      if (userId) {
        setPendingRejoin({ userId, userName: listenerName });
        setKickedUsers((prev) => {
          if (prev.some((u) => u.id === userId)) return prev;
          const updated = [...prev, { id: userId, name: listenerName }];
          if (typeof window !== 'undefined' && session.id) {
            try {
              sessionStorage.setItem(`host_kicked_users_${session.id}`, JSON.stringify(updated));
            } catch (e) {}
          }
          return updated;
        });
      }
      setActionNotice(`🔔 ${listenerName} requested to rejoin`);
      setTimeout(() => setActionNotice(null), 6000);
    });
    return unregister;
  }, [session.id]);

  // Listen to automatic transmission mode adjustments from WebRTC session manager
  useEffect(() => {
    const unregister = webRtcSessionManager.addModeNoticeListener((notice, isDowngrade) => {
      setActionNotice(isDowngrade ? `⚠️ ${notice}` : `✅ ${notice}`);
      setTimeout(() => setActionNotice(null), 5000);
    });
    return unregister;
  }, []);

  // Start persistent Telegram-style foreground push service to keep broadcast running when minimized
  useEffect(() => {
    startBackgroundLiveService(session.title || 'Zikr Session', true);
    return () => {
      stopBackgroundLiveService();
    };
  }, [session.title]);

  // Auto-resolve active live session ID if not yet populated in store (e.g. page refresh)
  useEffect(() => {
    const resolveActiveSession = async () => {
      if (!session.id && user?.id) {
        try {
          const { data: activeLive } = await supabase
            .from('live_sessions')
            .select('id, title, cloudflare_session_id, cloudflare_track_id, media_generation, state, started_at, host_id')
            .eq('state', 'LIVE')
            .eq('host_id', user.id)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (activeLive) {
            updateSession({
              id: activeLive.id,
              title: activeLive.title || session.title,
              state: 'LIVE',
              mediaGeneration: activeLive.media_generation,
              cloudflareSessionId: activeLive.cloudflare_session_id,
              cloudflareTrackId: activeLive.cloudflare_track_id,
            });
          }
        } catch (err) {
          console.warn('[HostLive] Failed to resolve active session ID:', err);
        }
      }
    };
    resolveActiveSession();
  }, [session.id, session.title, user?.id, updateSession]);

  // Ensure host presence is active on mount
  useEffect(() => {
    if (session.id && user) {
      presenceManager.subscribeSessionPresence(session.id, {
        id: user.id,
        name: user.fullName || 'Our Murshid',
        avatarUrl: user.avatarUrl,
        isHost: true,
      });
    }
  }, [session.id, user?.id]);

  // Ensure audio capture is running if not yet active
  useEffect(() => {
    if (audioEngine.getStatus() === 'uninitialized') {
      audioEngine.startCapture().catch((err) => {
        console.warn('[HostLive] Audio capture startup notice:', err);
      });
    }
  }, []);


  // Background broadcast preservation via WakeLock and MediaSession
  useEffect(() => {
    let wakeLockSentinel: unknown = null;
    if ('wakeLock' in navigator) {
      (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } })
        .wakeLock.request('screen')
        .then((wl) => {
          wakeLockSentinel = wl;
        })
        .catch(() => {});
    }

    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: session.title || 'Live Broadcasting',
        artist: 'Our Murshid (Host)',
        album: 'Tariqah al-Raj Live',
        artwork: [
          { src: '/assets/app-logo.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';
    }

    return () => {
      if (wakeLockSentinel && typeof (wakeLockSentinel as { release: () => Promise<void> }).release === 'function') {
        (wakeLockSentinel as { release: () => Promise<void> }).release().catch(() => {});
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    };
  }, [session.title]);

  // Recording timer tracking
  useEffect(() => {
    let timer: number | null = null;
    if (isRecording) {
      timer = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRecording]);

  const handleToggleRecord = async () => {
    if (!isRecording) {
      const stream = audioEngine.getBroadcastStream();
      const started = audioRecorder.start(stream);
      if (started) {
        setIsRecording(true);
        setActionNotice('🔴 Recording started');
        setTimeout(() => setActionNotice(null), 3000);
      } else {
        alert('Could not start recording. Please make sure the microphone is active.');
      }
    } else {
      const duration = recordingSeconds;
      const blob = await audioRecorder.stop();
      setIsRecording(false);
      if (blob && blob.size > 0) {
        const title = session.title || 'Zikr Session';
        const filename = audioRecorder.generateFilename(title, blob.type);
        const savedLocation = await audioRecorder.download(blob, title, filename);
        await recordingsManager.saveRecording({
          title,
          blob,
          durationSeconds: duration,
          savedPath: savedLocation,
          filename,
        });
        setActionNotice(`💾 Saved to ${savedLocation || 'Downloads'}`);
        setTimeout(() => setActionNotice(null), 4000);
      }
    }
  };

  const handleConfirmKick = () => {
    if (!targetKickUser) return;
    const userToKick = { id: targetKickUser.id, name: targetKickUser.name };
    presenceManager.kickListener(userToKick.id, userToKick.name);
    setKickedUsers((prev) => {
      const updated = [...prev.filter((u) => u.id !== userToKick.id), userToKick];
      if (typeof window !== 'undefined' && session.id) {
        try {
          sessionStorage.setItem(`host_kicked_users_${session.id}`, JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
    setActionNotice(`Removed ${userToKick.name} from broadcast`);
    setTimeout(() => setActionNotice(null), 3000);
    setTargetKickUser(null);
  };

  const handleConfirmBan = () => {
    if (!targetKickUser) return;
    const userToBan = { id: targetKickUser.id, name: targetKickUser.name, avatarUrl: targetKickUser.avatarUrl };
    presenceManager.banListener(userToBan.id, userToBan.name, userToBan.avatarUrl);
    setKickedUsers((prev) => {
      const updated = prev.filter((u) => u.id !== userToBan.id);
      if (typeof window !== 'undefined' && session.id) {
        try {
          sessionStorage.setItem(`host_kicked_users_${session.id}`, JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
    setActionNotice(`Permanently banned ${userToBan.name}`);
    setTimeout(() => setActionNotice(null), 3000);
    setTargetKickUser(null);
  };

  const handleAllowRejoin = (user: { id: string; name: string }) => {
    presenceManager.unkickListener(user.id);
    setKickedUsers((prev) => {
      const updated = prev.filter((u) => u.id !== user.id);
      if (typeof window !== 'undefined' && session.id) {
        try {
          sessionStorage.setItem(`host_kicked_users_${session.id}`, JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
    setActionNotice(`Allowed ${user.name} to rejoin`);
    setTimeout(() => setActionNotice(null), 3000);
  };

  const handleToggleMute = () => {
    const nextMuted = !session.isHostMuted;
    audioEngine.setMute(nextMuted);
    webRtcSessionManager.setMute(nextMuted);
    toggleHostMute();
    presenceManager.broadcastHostMute(nextMuted);
  };

  const handleToggleTransmissionMode = () => {
    const nextMode = session.transmissionMode === 'standard' ? 'low-data' : 'standard';
    webRtcSessionManager.setTransmissionMode(nextMode);
    setTransmissionMode(nextMode);
    setActionNotice(
      nextMode === 'low-data'
        ? '🍃 Switched to Data Saver Mode'
        : '⚡ Switched to Standard Mode'
    );
    setTimeout(() => setActionNotice(null), 3000);
  };

  const handleEndLive = async () => {
    if (window.confirm('Are you sure you want to end this live session?')) {
      // 0. Automatically finalize and download audio recording if active
      if (isRecording) {
        try {
          const duration = recordingSeconds;
          const blob = await audioRecorder.stop();
          setIsRecording(false);
          if (blob && blob.size > 0) {
            const title = session.title || 'Zikr Session';
            const filename = audioRecorder.generateFilename(title, blob.type);
            const savedPath = await audioRecorder.download(blob, title, filename);
            await recordingsManager.saveRecording({
              title,
              blob,
              durationSeconds: duration,
              savedPath,
              filename,
            });
          }
        } catch (recErr) {
          console.warn('[HostLive] Error stopping recording on end live:', recErr);
        }
      }

      // 1. Call backend RPCs to transition session to ENDED
      if (session.id) {
        try {
          await supabase.rpc('end_host_session', { p_session_id: session.id });
          await supabase.rpc('finalize_host_session', { p_session_id: session.id });
        } catch (err) {
          console.warn('[HostLive] Session finalization error:', err);
        }
      }

      // 2. Clear kicked users storage for this session
      if (typeof window !== 'undefined' && session.id) {
        try {
          sessionStorage.removeItem(`host_kicked_users_${session.id}`);
        } catch (e) {}
      }
      setKickedUsers([]);

      // 3. Teardown WebRTC transport
      stopBackgroundLiveService();
      webRtcSessionManager.teardown();

      // 4. Teardown presence and stop lease loop
      presenceManager.leavePresence();

      // 5. Cleanup recovery coordinator
      recoveryCoordinator.cleanup();

      // 6. Cleanup audio engine
      audioEngine.dispose();

      // 7. Reset session status and navigate to host prelive
      endSession();
      setView('host-prelive');
    }
  };

  // Exclude host from listeners list (only real signed-in listeners shown)
  const listeners = participants.filter((p) => !p.isHost);

  return (
    <div className="w-full flex flex-col min-h-screen bg-slate-50 md:bg-slate-100/60 justify-between overflow-hidden">
      {/* Green Top Bar */}
      <div className="w-full bg-[#15803D] text-white px-4 md:px-8 lg:px-12 pt-safe pb-2.5 md:py-3.5 shrink-0 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2 -ml-1 overflow-hidden min-w-0">
          <button
            type="button"
            onClick={() => setView('host-prelive')}
            className="p-1.5 text-white hover:text-emerald-100 hover:bg-white/10 rounded-full transition cursor-pointer shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
          </button>
          <div className="overflow-hidden min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-white tracking-tight leading-tight truncate">
              Tariqah al-Raj
            </h1>
            <p className="text-xs text-emerald-100 font-medium truncate">
              {session.title || 'Live Broadcast'}
            </p>
          </div>
        </div>

        {/* Top bar right: Host Dashboard Icon & Unified Live Badge */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0 ml-2">
          <button
            type="button"
            onClick={() => {
              setPreviousHostView('host-live');
              setView('host-dashboard');
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition cursor-pointer border border-white/15 shrink-0"
            title="Host Dashboard"
            aria-label="Host Dashboard"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>

          {/* Small Live Pill with Duration Underneath */}
          <div className="flex flex-col items-end shrink-0">
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white shadow-2xs mb-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span className="text-[10px] font-bold tracking-wider leading-none">
                LIVE
              </span>
            </div>
            <span className="text-xs font-semibold text-emerald-100 tracking-wider font-mono leading-none">
              {formatDuration(session.elapsedSeconds)}
            </span>
          </div>
        </div>
      </div>

      {/* ================= DESKTOP 2-PANEL STUDIO CONSOLE (>= md) ================= */}
      <div className="hidden md:flex flex-1 max-w-7xl mx-auto w-full p-6 lg:p-8 gap-6 overflow-hidden items-stretch">
        {/* Left Column: Broadcast Controls & Audio Status */}
        <div className="w-80 lg:w-96 shrink-0 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 flex flex-col justify-between">
          <div className="flex flex-col items-center text-center">
            {/* Audio Indicator: Real-Time Audio-Reactive Microphone Pulse */}
            <AudioReactiveMicPulse
              isMuted={session.isHostMuted}
              isLive={session.state === 'LIVE'}
              onClick={handleToggleMute}
              mutedBgClass="bg-slate-200 text-slate-500"
              activeBgClass="bg-[#15803D] text-white"
            />

            {/* Transmission Mode / Mute Pill (Replaces "Broadcasting Live" text) */}
            {session.isHostMuted ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 mt-2 mb-0.5">
                <MicOff className="w-3.5 h-3.5 text-rose-600" />
                <span>Microphone Muted</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleToggleTransmissionMode}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer border shadow-2xs mt-2 mb-0.5 ${
                  session.transmissionMode === 'low-data'
                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}
                title="Tap to switch transmission mode"
              >
                {session.transmissionMode === 'low-data' ? (
                  <>
                    <Leaf className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
                    <span>Data Saver</span>
                    {session.isAutoDowngraded && (
                      <span className="text-[9px] bg-amber-200 text-amber-900 px-1 py-0.2 rounded font-bold uppercase">Auto</span>
                    )}
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
                    <span>Standard</span>
                  </>
                )}
              </button>
            )}
            <p className="text-xs text-slate-500 mt-1">
              {session.title || 'Live Broadcast'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-6 border-t border-slate-100">
            {/* Mute Button */}
            <button
              type="button"
              onClick={handleToggleMute}
              className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold text-sm transition cursor-pointer border ${
                session.isHostMuted
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
              }`}
            >
              {session.isHostMuted ? (
                <>
                  <Mic className="w-4 h-4 text-amber-700" />
                  <span>Unmute Microphone</span>
                </>
              ) : (
                <>
                  <MicOff className="w-4 h-4 text-slate-500" />
                  <span>Mute Microphone</span>
                </>
              )}
            </button>

            {/* Record Button */}
            <button
              type="button"
              onClick={handleToggleRecord}
              className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold text-sm transition cursor-pointer border ${
                isRecording
                  ? 'bg-rose-50 border-rose-300 text-rose-700'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
              }`}
            >
              <Square className={`w-3.5 h-3.5 ${isRecording ? 'fill-rose-600 text-rose-600' : 'fill-rose-500 text-rose-500'}`} />
              {isRecording && <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />}
              <span>{isRecording ? `Recording (${formatDuration(recordingSeconds)})` : 'Record Audio'}</span>
            </button>

            {/* End Live Button */}
            <button
              type="button"
              onClick={handleEndLive}
              className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white flex items-center justify-center gap-2 font-bold text-sm shadow-xs transition cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
              <span>End Broadcast</span>
            </button>
          </div>
        </div>

        {/* Right Column: Audience & Real-Time Roster */}
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

          {/* Pending Rejoin Request Notification (Desktop) */}
          {pendingRejoin && (
            <div className="my-3 bg-slate-900 text-white text-xs font-medium p-3 rounded-xl border border-slate-700 flex items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span><strong className="text-emerald-300">{pendingRejoin.userName}</strong> requested to rejoin.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    handleAllowRejoin({ id: pendingRejoin.userId, name: pendingRejoin.userName });
                    setPendingRejoin(null);
                  }}
                  className="bg-[#15803D] hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRejoin(null)}
                  className="text-slate-400 hover:text-white p-1 transition cursor-pointer"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Action Notification (Desktop) */}
          {actionNotice && (
            <div className="my-2 bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-xl border border-slate-700 text-center animate-in fade-in">
              {actionNotice}
            </div>
          )}

          {/* Listeners Grid */}
          <div className="flex-1 overflow-y-auto py-4">
            {listeners.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-2.5">
                  <Users className="w-6 h-6 text-slate-400" />
                </div>
                <h4 className="text-sm font-bold text-slate-700">No listeners yet</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Listeners who join will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {listeners.map((listener) => (
                  <div
                    key={listener.id}
                    onClick={() => setTargetKickUser({ id: listener.id, name: listener.name, avatarUrl: listener.avatarUrl })}
                    className="flex flex-col items-center p-3 rounded-xl bg-slate-50/70 hover:bg-slate-100 border border-slate-200/60 transition cursor-pointer group text-center"
                    title={`Moderate ${listener.name}`}
                  >
                    <div className="relative w-12 h-12 mb-2 shrink-0">
                      {listener.avatarUrl ? (
                        <div className="w-full h-full rounded-full overflow-hidden border border-slate-200 bg-slate-100 shadow-2xs group-hover:border-emerald-600 transition">
                          <img
                            src={listener.avatarUrl}
                            alt={listener.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full rounded-full bg-emerald-100 text-[#15803D] flex items-center justify-center font-bold text-sm border border-emerald-200 shadow-2xs group-hover:border-emerald-600 transition">
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
            )}
          </div>

          {/* Kicked Listeners Drawer */}
          {kickedUsers.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Removed ({kickedUsers.length})
              </h4>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {kickedUsers.map((kUser) => (
                  <div key={kUser.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <span className="font-semibold text-slate-700 truncate max-w-[140px]">{kUser.name}</span>
                    <button
                      type="button"
                      onClick={() => handleAllowRejoin(kUser)}
                      className="text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      Allow Rejoin
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= MOBILE VIEW (< md) ================= */}
      <div className="w-full flex-1 flex flex-col justify-between px-5 pb-safe overflow-hidden md:hidden">
        {/* Center Broadcast Status & Ripple (Image 5 layout) */}
        <div className="flex flex-col items-center justify-center text-center my-1 shrink-0">
          {/* Audio Indicator: Real-Time Audio-Reactive Microphone Pulse */}
          <AudioReactiveMicPulse
            isMuted={session.isHostMuted}
            isLive={session.state === 'LIVE'}
            onClick={handleToggleMute}
            mutedBgClass="bg-slate-500 text-white"
            activeBgClass="bg-[#15803D] text-white"
          />

          {/* Transmission Mode / Mute Pill (Replaces "Broadcasting Live" text) */}
          {session.isHostMuted ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 mt-2 mb-1">
              <MicOff className="w-3.5 h-3.5 text-rose-600" />
              <span>Microphone Muted</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleToggleTransmissionMode}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer border shadow-2xs mt-2 mb-1 ${
                session.transmissionMode === 'low-data'
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
              }`}
              title="Tap to switch transmission mode"
            >
              {session.transmissionMode === 'low-data' ? (
                <>
                  <Leaf className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
                  <span>Data Saver</span>
                  {session.isAutoDowngraded && (
                    <span className="text-[9px] bg-amber-200 text-amber-900 px-1 py-0.2 rounded font-bold uppercase">Auto</span>
                  )}
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
                  <span>Standard</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Listeners Grid Section */}
        <div className="flex-1 overflow-y-auto px-1 pt-1 pb-2">
          {/* Listeners Header */}
          <div className="flex items-center justify-between mb-3 border-t border-slate-100 pt-2.5">
            <h3 className="text-sm font-bold text-slate-900">
              Listeners ({session.listenerCount})
            </h3>
            <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
              <span className="w-2 h-2 rounded-full bg-[#15803D]" />
              <span>Online</span>
            </div>
          </div>

          {/* Listeners Grid */}
          {listeners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-1.5">
                <Users className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-xs font-semibold text-slate-700">No listeners yet</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Listeners who join will appear here</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-y-3 gap-x-2 text-center">
              {listeners.map((listener) => (
                <div
                  key={listener.id}
                  onClick={() => setTargetKickUser({ id: listener.id, name: listener.name, avatarUrl: listener.avatarUrl })}
                  className="flex flex-col items-center cursor-pointer group hover:opacity-95 active:scale-95 transition"
                  title={`Manage ${listener.name}`}
                >
                  <div className="relative w-[52px] h-[52px] mb-1.5 shrink-0">
                    {listener.avatarUrl ? (
                      <div className="w-full h-full rounded-full overflow-hidden border-2 border-slate-200 bg-slate-100 shadow-2xs group-hover:border-emerald-600 group-hover:ring-2 group-hover:ring-emerald-100 transition">
                        <img
                          src={listener.avatarUrl}
                          alt={listener.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-full rounded-full bg-emerald-100 text-[#15803D] flex items-center justify-center font-bold text-sm border-2 border-emerald-200 shadow-2xs group-hover:border-emerald-600 group-hover:ring-2 group-hover:ring-emerald-100 transition">
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
          )}

          {/* Kicked Listeners with Allow Rejoin option */}
          {kickedUsers.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Removed ({kickedUsers.length})
              </h4>
              <div className="flex flex-col gap-1.5">
                {kickedUsers.map((kUser) => (
                  <div key={kUser.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200/60">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[170px]">{kUser.name}</span>
                    <button
                      type="button"
                      onClick={() => handleAllowRejoin(kUser)}
                      className="text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-3 py-1 rounded-lg transition cursor-pointer"
                    >
                      Allow Rejoin
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rejoin Request Banner with Quick Allow */}
        {pendingRejoin && (
          <div className="mx-auto my-1 bg-[#0F2942] text-white text-xs font-semibold px-4 py-2 rounded-2xl shadow-xl border border-emerald-500/50 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="truncate max-w-[150px]">{pendingRejoin.userName} requested to rejoin</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  handleAllowRejoin({ id: pendingRejoin.userId, name: pendingRejoin.userName });
                  setPendingRejoin(null);
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded-xl transition cursor-pointer shadow-xs"
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => setPendingRejoin(null)}
                className="text-slate-400 hover:text-white p-1 transition cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Action Toast Notification */}
        {actionNotice && (
          <div className="mx-auto my-1 bg-[#0F2942] text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-md border border-slate-700 animate-in fade-in duration-150 shrink-0 text-center">
            {actionNotice}
          </div>
        )}

        {/* Bottom Floating Control Bar */}
        <div className="w-full pt-3 pb-3 border-t border-slate-100 bg-white shrink-0">
          <div className="grid grid-cols-3 max-w-xs mx-auto px-2 place-items-center">
            {/* Record Button */}
            <div className="flex flex-col items-center justify-center w-full">
              <button
                type="button"
                onClick={handleToggleRecord}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition shadow-2xs cursor-pointer ${
                  isRecording
                    ? 'bg-rose-50 border-2 border-rose-500 text-rose-600'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
              >
                {isRecording ? (
                  <Square className="w-5 h-5 fill-rose-600 text-rose-600" />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-rose-600" />
                )}
              </button>
              <span className="text-xs font-semibold text-slate-600 mt-1.5 flex items-center justify-center gap-1.5 tabular-nums whitespace-nowrap h-4">
                {isRecording && <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse shrink-0" />}
                <span>{isRecording ? `REC ${formatDuration(recordingSeconds)}` : 'Record'}</span>
              </span>
            </div>

            {/* Mute Button */}
            <div className="flex flex-col items-center justify-center w-full">
              <button
                type="button"
                onClick={handleToggleMute}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition shadow-2xs cursor-pointer ${
                  session.isHostMuted
                    ? 'bg-slate-200 text-slate-800'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                aria-label={session.isHostMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {session.isHostMuted ? (
                  <MicOff className="w-6 h-6 text-red-600" />
                ) : (
                  <Mic className="w-6 h-6 text-slate-700" />
                )}
              </button>
              <span className="text-xs font-semibold text-slate-600 mt-1.5 whitespace-nowrap h-4 flex items-center justify-center">
                {session.isHostMuted ? 'Unmute' : 'Mute'}
              </span>
            </div>

            {/* End Live Button */}
            <div className="flex flex-col items-center justify-center w-full">
              <button
                type="button"
                onClick={handleEndLive}
                className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white flex items-center justify-center shadow-md transition cursor-pointer"
                aria-label="End Live Broadcast"
              >
                <Square className="w-5 h-5 fill-white text-white" />
              </button>
              <span className="text-xs font-bold text-red-600 mt-1.5 whitespace-nowrap h-4 flex items-center justify-center">
                End Live
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Kick Confirmation Modal (Rendered across mobile & desktop) */}
      {targetKickUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-xs bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 flex flex-col items-center text-center">
            {targetKickUser.avatarUrl ? (
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-slate-200 bg-slate-100 mb-2 shadow-xs">
                <img
                  src={targetKickUser.avatarUrl}
                  alt={targetKickUser.name}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-[#15803D] flex items-center justify-center font-bold text-base border-2 border-emerald-200 mb-2 shadow-xs">
                {getInitials(targetKickUser.name)}
              </div>
            )}
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {targetKickUser.name}
            </h3>
            <div className="w-full flex flex-col gap-2">
              {/* Kick (This Session Only) Button */}
              <button
                type="button"
                onClick={handleConfirmKick}
                className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <UserX className="w-4 h-4" />
                <span>Kick from this session</span>
              </button>

              {/* Ban Permanently Button */}
              <button
                type="button"
                onClick={handleConfirmBan}
                className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ShieldBan className="w-4 h-4" />
                <span>Ban Permanently</span>
              </button>

              {/* Cancel Button */}
              <button
                type="button"
                onClick={() => setTargetKickUser(null)}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer mt-0.5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

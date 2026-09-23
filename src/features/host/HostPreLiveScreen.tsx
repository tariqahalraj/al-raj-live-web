import React, { useEffect, useState } from 'react';
import {
  Mic,
  MicOff,
  Radio,
  Loader2,
  Edit2,
  ArrowRight,
  PhoneOff,
  Users,
  Clock,
  LayoutDashboard,
  Zap,
  Leaf,
} from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { audioEngine, recordingService } from '@/features/audio-engine';
import { webRtcSessionManager } from '@/features/media-transport';
import { presenceManager, recoveryCoordinator } from '@/features/live-session';
import { formatDuration } from '@/shared/utils/format';
import { supabase } from '@/core/supabase-client';
import { getInitials } from '@/features/live-session/participants-data';
import { EditProfileModal } from '@/features/profile/EditProfileModal';

export const HostPreLiveScreen: React.FC = () => {
  const { setView, setPreviousHostView, session, user, updateSession, endSession, setTransmissionMode } = useAppStore();
  const [isStarting, setIsStarting] = useState(false);
  const [sessionTitle, setSessionTitle] = useState(session.title || 'Zikr Session');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Safeguard: verify user is authenticated and is actually host
  useEffect(() => {
    if (!user) {
      setView('sign-in');
      return;
    }
    const isHost = user.role === 'HOST' || user.role === 'ADMIN';
    if (!isHost) {
      setView('listener-preview');
    }
  }, [user, setView]);

  // Check if there is an active session in Supabase if store doesn't show LIVE yet
  useEffect(() => {
    const checkActiveHostSession = async () => {
      if (session.state === 'LIVE') return;
      try {
        const { data } = await supabase
          .from('live_sessions')
          .select('id, title, state, media_generation, started_at, cloudflare_session_id, cloudflare_track_id')
          .eq('state', 'LIVE')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data) {
          const startedAt = data.started_at ? new Date(data.started_at).getTime() : Date.now();
          const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
          updateSession({
            id: data.id,
            title: data.title || 'Zikr Session',
            state: 'LIVE',
            mediaGeneration: data.media_generation,
            elapsedSeconds,
            cloudflareSessionId: data.cloudflare_session_id,
            cloudflareTrackId: data.cloudflare_track_id,
          });
        }
      } catch (err) {
        console.warn('[HostPreLive] Error checking active session:', err);
      }
    };
    checkActiveHostSession();
  }, [session.state, updateSession]);

  const handleStartLive = async () => {
    if (isStarting) return;
    setIsStarting(true);

    try {
      // 1. Authoritative backend RPC: Create session in STARTING state
      let activeSessionId = session.id;
      let mediaGen = 1;

      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('start_host_session', {
          p_title: sessionTitle || 'Zikr Session',
        });

        if (rpcErr) {
          console.warn('[HostPreLive] start_host_session notice:', rpcErr.message);
          // If an active session already exists in DB, recover its ID
          const { data: existing } = await supabase
            .from('live_sessions')
            .select('id, media_generation, state')
            .in('state', ['STARTING', 'LIVE'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existing) {
            activeSessionId = existing.id;
            mediaGen = existing.media_generation;
          }
        } else if (rpcData) {
          activeSessionId = rpcData.id;
          mediaGen = rpcData.media_generation || 1;
        }
      } catch (dbErr) {
        console.warn('[HostPreLive] DB session initialization exception:', dbErr);
      }

      if (!activeSessionId) {
        activeSessionId = `session-${Date.now()}`;
      }

      // 2. Start audio engine microphone capture
      const destStream = await audioEngine.startCapture();

      // 3. Start local recording if enabled
      if (session.isRecording) {
        recordingService.startRecording(destStream, activeSessionId);
      }

      // 4. Start WebRTC publishing to Cloudflare SFU
      const publishedTrack = await webRtcSessionManager.publishHostAudio(
        activeSessionId,
        destStream,
        mediaGen,
        session.transmissionMode || 'standard'
      );

      // 5. Confirm initial publication in database (STARTING -> LIVE)
      if (activeSessionId && publishedTrack) {
        try {
          await supabase.rpc('confirm_initial_publish', {
            p_session_id: activeSessionId,
            p_cf_session_id: webRtcSessionManager.getCloudflareSessionId() || '',
            p_cf_track_id: publishedTrack.trackName,
          });
        } catch (confirmErr) {
          console.warn('[HostPreLive] confirm_initial_publish notice:', confirmErr);
        }
      }

      // 6. Start host heartbeat presence lease loop (15s heartbeat, 45s TTL)
      presenceManager.startHostLeaseLoop(activeSessionId);

      // 7. Subscribe to real-time presence channel as host
      presenceManager.subscribeSessionPresence(activeSessionId, {
        id: user?.id || 'host-user',
        name: user?.fullName || 'Our Murshid',
        avatarUrl: user?.avatarUrl,
        isHost: true,
      });

      // 8. Initialize recovery coordinator
      recoveryCoordinator.setSession(activeSessionId, true);

      // 9. Update store state and navigate to HostLiveScreen
      updateSession({
        id: activeSessionId,
        title: sessionTitle || 'Zikr Session',
        state: 'LIVE',
        mediaGeneration: mediaGen,
        elapsedSeconds: 0,
        cloudflareSessionId: webRtcSessionManager.getCloudflareSessionId() || undefined,
        cloudflareTrackId: publishedTrack?.trackName,
      });
      setView('host-live');
    } catch (err) {
      console.error('[HostPreLive] Error during start live:', err);
      setView('host-live');
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndLive = async () => {
    if (window.confirm('Are you sure you want to end this live session?')) {
      if (session.isRecording) {
        await recordingService.stopRecording();
      }

      if (session.id) {
        try {
          await supabase.rpc('end_host_session', { p_session_id: session.id });
          await supabase.rpc('finalize_host_session', { p_session_id: session.id });
        } catch (err) {
          console.warn('[HostPreLive] Session finalization error:', err);
        }
      }

      webRtcSessionManager.teardown();
      presenceManager.stopHostLeaseLoop();
      recoveryCoordinator.cleanup();
      audioEngine.dispose();
      endSession();
      updateSession({ state: 'ENDED', id: '', elapsedSeconds: 0 });
      setView('host-prelive');
    }
  };

  const isLive = session.state === 'LIVE';

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
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/assets/host-avatar.jpg';
                }}
              />
            ) : (
              <div className="w-full h-full bg-emerald-800 text-white flex items-center justify-center font-bold text-sm">
                {getInitials(user?.fullName || user?.email || 'Host')}
              </div>
            )}
          </button>

          <div>
            <h1 className="text-lg md:text-xl font-bold text-white tracking-tight leading-tight">
              Tariqah al-Raj
            </h1>
            <p className="text-xs text-emerald-100/90 font-medium">
              Live Broadcast
            </p>
          </div>
        </div>

        {/* Right side: Dashboard button and options menu */}
        <div className="flex items-center gap-2 relative">
          {/* Dashboard Button */}
          <button
            type="button"
            onClick={() => {
              setPreviousHostView('host-prelive');
              setView('host-dashboard');
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition cursor-pointer border border-white/15"
            title="Host Dashboard"
            aria-label="Host Dashboard"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
        </div>
      </div>

      {isLive ? (
        /* ================= ACTIVE LIVE RUNNING STATE ================= */
        <div className="flex-1 flex flex-col justify-between items-center text-center py-4 px-6 max-w-md md:max-w-xl mx-auto w-full">
          {/* Live Status & Graphic Center Area */}
          <div className="flex-1 flex flex-col items-center justify-center text-center my-auto w-full">
            {/* Live Badge */}
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-red-50 border border-red-200 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
              <span className="text-xs font-bold text-red-600 tracking-wider">
                LIVE BROADCAST RUNNING
              </span>
            </div>

            {/* Concentric Circle Pulse */}
            <div className="w-48 h-48 relative flex items-center justify-center mx-auto my-2 shrink-0">
              <div className="absolute w-44 h-44 rounded-full bg-[#EAFBF3] animate-pulse-ring" />
              <div className="absolute w-36 h-36 rounded-full bg-[#D1F7E4]" />
              <div className="relative z-10 w-28 h-28 rounded-full bg-[#15803D] flex items-center justify-center shadow-md">
                {session.isHostMuted ? (
                  <MicOff className="w-12 h-12 text-white stroke-[2.2]" />
                ) : (
                  <Mic className="w-12 h-12 text-white stroke-[2.2]" />
                )}
              </div>
            </div>

            {/* Session Title & Host Role */}
            <h2 className="text-2xl font-bold text-[#0F2942] mt-3 mb-1">
              {session.title || 'Zikr Session'}
            </h2>
            <p className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full inline-block mb-5">
              Broadcasting as Our Murshid
            </p>

            {/* Live Session Stats Row */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs mb-2">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 justify-center">
                <Clock className="w-4 h-4 text-slate-500" />
                <div className="text-left">
                  <p className="text-[10px] text-slate-400 font-medium">Duration</p>
                  <p className="text-xs font-bold text-slate-800 font-mono">
                    {formatDuration(session.elapsedSeconds)}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 justify-center">
                <Users className="w-4 h-4 text-slate-500" />
                <div className="text-left">
                  <p className="text-[10px] text-slate-400 font-medium">Listeners</p>
                  <p className="text-xs font-bold text-slate-800">
                    {session.listenerCount}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons: Pinned to the bottom */}
          <div className="w-full pb-6 pt-2 shrink-0 space-y-3">
            <button
              type="button"
              onClick={() => setView('host-live')}
              className="w-full py-4 px-6 bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white font-semibold rounded-2xl shadow-md flex items-center justify-center gap-2.5 transition duration-150 cursor-pointer text-base"
            >
              <Radio className="w-5 h-5 stroke-[2.5]" />
              <span className="tracking-wide">
                Return to Live Console
              </span>
              <ArrowRight className="w-5 h-5 ml-1" />
            </button>

            <button
              type="button"
              onClick={handleEndLive}
              className="w-full py-4 px-6 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold rounded-2xl shadow-md flex items-center justify-center gap-2.5 transition duration-150 cursor-pointer text-base"
            >
              <PhoneOff className="w-5 h-5" />
              <span className="tracking-wide">End Live Session</span>
            </button>
          </div>
        </div>
      ) : (
        /* ================= PRE-LIVE SETUP STATE ================= */
        <div className="flex-1 flex flex-col justify-between items-center py-4 px-6 max-w-md md:max-w-xl mx-auto w-full">
          {/* Graphic and Title Center Area */}
          <div className="flex-1 flex flex-col items-center justify-center text-center my-auto w-full">
            {/* Concentric Circle Graphic with Microphone */}
            <div className="w-48 h-48 md:w-52 md:h-52 relative flex items-center justify-center mx-auto my-3 shrink-0">
              <div className="absolute w-44 h-44 md:w-48 md:h-48 rounded-full bg-[#EAFBF3] animate-pulse-ring" />
              <div className="absolute w-36 h-36 md:w-38 md:h-38 rounded-full bg-[#D1F7E4]" />
              <div className="relative z-10 w-28 h-28 rounded-full bg-[#15803D] flex items-center justify-center shadow-md">
                <Mic className="w-12 h-12 text-white stroke-[2.2]" />
              </div>
            </div>

            {/* Heading & Subtitle / Editable Title */}
            <div className="text-center mb-2 w-full">
              {isEditingTitle ? (
                <div className="flex items-center gap-2 justify-center w-full mb-1">
                  <input
                    type="text"
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    className="border border-[#15803D] rounded-xl px-3 py-1.5 text-xl font-bold text-[#0F2942] text-center outline-none w-full max-w-xs"
                    autoFocus
                    onBlur={() => setIsEditingTitle(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setIsEditingTitle(false);
                    }}
                  />
                </div>
              ) : (
                <div
                  onClick={() => setIsEditingTitle(true)}
                  className="flex items-center justify-center gap-2 mb-1 cursor-pointer group"
                  title="Tap to rename session"
                >
                  <h2 className="text-2xl font-bold text-[#0F2942] group-hover:text-[#15803D] transition">
                    {sessionTitle || 'Ready to Go Live'}
                  </h2>
                  <Edit2 className="w-4 h-4 text-slate-400 group-hover:text-[#15803D] transition" />
                </div>
              )}
              <p className="text-sm text-slate-500">
                Your voice will be broadcast to listeners.
              </p>
            </div>
          </div>

          {/* Transmission Mode: Clean Two Boxes with Minimal Text */}
          <div className="w-full mb-3 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setTransmissionMode('standard')}
              className={`py-3 px-3 rounded-2xl border text-center transition cursor-pointer flex items-center justify-center gap-2 ${
                session.transmissionMode === 'standard'
                  ? 'border-[#15803D] bg-emerald-50 text-[#15803D] font-bold shadow-2xs'
                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 font-medium'
              }`}
            >
              <Zap className="w-4 h-4 text-emerald-600" />
              <span className="text-sm">Standard</span>
            </button>

            <button
              type="button"
              onClick={() => setTransmissionMode('low-data')}
              className={`py-3 px-3 rounded-2xl border text-center transition cursor-pointer flex items-center justify-center gap-2 ${
                session.transmissionMode === 'low-data'
                  ? 'border-[#15803D] bg-emerald-50 text-[#15803D] font-bold shadow-2xs'
                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600 font-medium'
              }`}
            >
              <Leaf className="w-4 h-4 text-emerald-600" />
              <span className="text-sm">Data Saver</span>
            </button>
          </div>

          {/* Primary Start Live CTA: Pinned to the bottom */}
          <div className="w-full pb-6 pt-1 shrink-0">
            <button
              type="button"
              onClick={handleStartLive}
              disabled={isStarting}
              className="w-full py-4 px-6 bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white font-semibold rounded-2xl shadow-sm flex items-center justify-center gap-3 transition duration-150 cursor-pointer disabled:opacity-75 text-base tracking-wide"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Connecting SFU...</span>
                </>
              ) : (
                <>
                  <Radio className="w-5 h-5 stroke-[2.5]" />
                  <span>Start Live</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </div>
  );
};

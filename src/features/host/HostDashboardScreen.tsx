import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, ShieldBan, BarChart3, Disc, CheckCircle, Clock, Radio, Users, 
  Search, Play, Pause, Trash2, Volume2, VolumeX, Menu, X, RotateCcw, RotateCw 
} from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { presenceManager, BannedUser } from '@/features/live-session/presence-manager';
import { getInitials } from '@/features/live-session/participants-data';
import { formatDuration } from '@/shared/utils/format';
import { recordingsManager, AppRecording } from '@/features/audio-engine/recordings-manager';
import { supabase } from '@/core/supabase-client';

const formatAudioTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${pad(remMins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
};

interface PastSession {
  id: string;
  title: string;
  state: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface SignedUserProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: 'USER' | 'HOST' | 'ADMIN';
  created_at: string;
}

interface SwipeableMobileRecordingCardProps {
  rec: AppRecording;
  isCurrent: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  isMuted: boolean;
  dateFormatted: string;
  sizeMb: string;
  onPlayToggle: () => void;
  onSeek: (time: number) => void;
  onSkip: (delta: number) => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onClosePlayer: () => void;
  onDelete: (rec: AppRecording) => void;
}

const SwipeableMobileRecordingCard: React.FC<SwipeableMobileRecordingCardProps> = ({
  rec,
  isCurrent,
  isPlaying,
  currentTime,
  duration,
  playbackSpeed,
  isMuted,
  dateFormatted,
  sizeMb,
  onPlayToggle,
  onSeek,
  onSkip,
  onCycleSpeed,
  onToggleMute,
  onClosePlayer,
  onDelete,
}) => {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  const triggerDelete = () => {
    setSwipeOffset(0);
    onDelete(rec);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    isDraggingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    if (Math.abs(diffX) > Math.abs(diffY) && diffX < 0) {
      isDraggingRef.current = true;
      const clamped = Math.max(-90, Math.min(0, diffX));
      setSwipeOffset(clamped);
    } else if (Math.abs(diffY) > Math.abs(diffX)) {
      setSwipeOffset(0);
    }
  };

  const handleTouchEnd = () => {
    if (swipeOffset < -50) {
      triggerDelete();
    } else {
      setSwipeOffset(0);
    }
    touchStartRef.current = null;
    isDraggingRef.current = false;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl select-none">
      {/* Background red delete reveal on swipe */}
      <div 
        onClick={triggerDelete}
        className="absolute inset-0 bg-red-600 rounded-2xl flex items-center justify-end px-5 text-white font-bold text-xs gap-1.5 cursor-pointer z-0"
      >
        <Trash2 className="w-5 h-5 text-white" />
        <span>Delete</span>
      </div>

      {/* Foreground card */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isDraggingRef.current ? 'none' : 'transform 0.2s ease-out',
        }}
        className={`relative z-10 bg-white rounded-2xl p-3.5 border transition shadow-xs ${
          isCurrent ? 'border-[#15803D] ring-2 ring-emerald-100' : 'border-slate-200/80'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <button
              type="button"
              onClick={onPlayToggle}
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-xs transition cursor-pointer bg-[#15803D] text-white hover:bg-[#166534] active:bg-[#14532D]"
              title={isCurrent && isPlaying ? 'Pause' : 'Play recording'}
              aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
            >
              {isCurrent && isPlaying ? (
                <Pause className="w-5 h-5 fill-white" />
              ) : (
                <Play className="w-5 h-5 fill-white ml-0.5" />
              )}
            </button>

            <div className="truncate">
              <h4 className="text-xs font-bold text-slate-900 truncate">
                {rec.title || 'Zikr Session'}
              </h4>
              <div className="flex items-center gap-2 mt-0.5">
                {rec.durationSeconds > 0 && (
                  <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded-md">
                    {formatDuration(rec.durationSeconds)}
                  </span>
                )}
                <span className="text-[10px] text-slate-400">
                  {sizeMb} MB
                </span>
                <span className="text-[10px] text-slate-400">
                  • {dateFormatted}
                </span>
              </div>
            </div>
          </div>

          {/* Action icon: Cross when playing/active, Delete when not playing */}
          <div className="flex items-center gap-1 shrink-0">
            {isCurrent ? (
              <button
                type="button"
                onClick={onClosePlayer}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                title="Close player"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onDelete(rec)}
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                title="Delete recording"
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {isCurrent && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            {/* Mobile Scrubber & Time */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-600 shrink-0 w-10 text-right">
                {formatAudioTime(currentTime)}
              </span>
              <input
                type="range"
                min="0"
                max={duration > 0 ? duration : (rec.durationSeconds || 1)}
                step="0.1"
                value={currentTime}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#15803D]"
              />
              <span className="text-[11px] font-mono text-slate-400 shrink-0 w-10">
                {formatAudioTime(duration > 0 ? duration : (rec.durationSeconds || 0))}
              </span>
            </div>

            {/* Mobile Quick Action Buttons */}
            <div className="flex items-center justify-between text-xs pt-0.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSkip(-10)}
                  className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Rewind 10s"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>-10s</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSkip(10)}
                  className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Forward 10s"
                >
                  <span>+10s</span>
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onCycleSpeed}
                  className="px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  title="Speed"
                >
                  {playbackSpeed}x
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-slate-600" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const HostDashboardScreen: React.FC = () => {
  const { setView, previousHostView, session, user } = useAppStore();
  const [activeTab, setActiveTab] = useState<'users' | 'banned' | 'history' | 'recordings'>('users');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>(() => presenceManager.getBannedUsers());
  const [signedUsers, setSignedUsers] = useState<SignedUserProfile[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('tariqah_cached_signed_users');
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }
    return [];
  });
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [recordings, setRecordings] = useState<AppRecording[]>([]);
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false);
  const [activeRecording, setActiveRecording] = useState<AppRecording | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioUrlMap, setAudioUrlMap] = useState<Record<string, string>>({});
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Sync recordings list from IndexedDB
  const fetchRecordings = async () => {
    setIsLoadingRecordings(true);
    try {
      const list = await recordingsManager.getAllRecordings();
      setRecordings(list);
    } catch (err) {
      console.warn('[HostDashboard] Failed to fetch recordings:', err);
    } finally {
      setIsLoadingRecordings(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  useEffect(() => {
    if (activeTab === 'recordings') {
      fetchRecordings();
    }
  }, [activeTab]);

  // Initialize audio element with listeners for real-time seeker & status
  useEffect(() => {
    const audio = new Audio();
    audioPlayerRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const onDurationChange = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onError = (e: Event) => {
      console.warn('[HostDashboard] Audio element error:', e);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
      Object.values(audioUrlMap).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handlePlayToggle = async (rec: AppRecording) => {
    const audio = audioPlayerRef.current;
    if (!audio) return;

    if (activeRecording?.id === rec.id) {
      if (isPlaying) {
        audio.pause();
      } else {
        audio.play().catch((err) => {
          console.warn('[HostDashboard] Playback resume failed:', err);
        });
      }
      return;
    }

    // Switch to another recording
    audio.pause();
    setCurrentTime(0);
    setDuration(rec.durationSeconds || 0);
    setActiveRecording(rec);

    let url = audioUrlMap[rec.id];
    if (!url) {
      let blob: Blob | null | undefined = rec.blob;
      if (!blob) {
        setActionNotice('Loading audio file...');
        blob = await recordingsManager.getAudioBlob(rec);
        setActionNotice(null);
      }
      if (!blob || blob.size === 0) {
        alert('Could not open audio recording: file is empty or unavailable.');
        setActiveRecording(null);
        return;
      }
      url = URL.createObjectURL(blob);
      setAudioUrlMap((prev) => ({ ...prev, [rec.id]: url }));
    }

    audio.src = url;
    audio.playbackRate = playbackSpeed;
    audio.muted = isMuted;
    audio.currentTime = 0;

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch((err) => {
      console.warn('[HostDashboard] Audio playback failed:', err);
      setIsPlaying(false);
    });
  };

  const handleSeek = (newTime: number) => {
    const audio = audioPlayerRef.current;
    if (audio) {
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleSkip = (seconds: number) => {
    const audio = audioPlayerRef.current;
    if (audio) {
      const maxDur = duration > 0 ? duration : (activeRecording?.durationSeconds || Infinity);
      const target = Math.max(0, Math.min(maxDur, audio.currentTime + seconds));
      audio.currentTime = target;
      setCurrentTime(target);
    }
  };

  const handleCycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.playbackRate = nextSpeed;
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.muted = nextMuted;
    }
  };

  const handleClosePlayer = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    setActiveRecording(null);
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleDeleteRecording = async (rec: AppRecording) => {
    const sizeMb = (rec.sizeBytes / 1024 / 1024).toFixed(1);
    if (window.confirm(`Delete recording "${rec.title}" (${sizeMb} MB)? This will permanently delete the file from your device.`)) {
      if (activeRecording?.id === rec.id) {
        handleClosePlayer();
      }
      await recordingsManager.deleteRecording(rec);
      await fetchRecordings();
      setActionNotice('🗑️ Recording deleted');
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  // Sync banned users list
  const refreshBannedUsers = () => {
    setBannedUsers(presenceManager.getBannedUsers());
  };

  // Fetch all signed-in/registered users from Supabase profiles table with REST fallback
  const fetchSignedUsers = async () => {
    setIsLoadingUsers(true);
    try {
      console.log('[HostDashboard] Fetching signed users from profiles...');
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role, created_at')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        console.log('[HostDashboard] Successfully fetched', data.length, 'profiles via Supabase SDK');
        setSignedUsers(data as SignedUserProfile[]);
        try {
          localStorage.setItem('tariqah_cached_signed_users', JSON.stringify(data));
        } catch (e) {}
        return;
      }

      if (error) {
        console.warn('[HostDashboard] Supabase SDK query returned error, using REST fallback:', error);
      }

      // REST fallback using public anon key
      const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodmlncW1jcGRieWpxY3VwbGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTY3OTgsImV4cCI6MjA4NTUzMjc5OH0.fRGQuX2zc7PnssNa8pufWM7KnCXF80hThAJ45KD6nj0';
      const response = await fetch(
        'https://ahvigqmcpdbyjqcuplhu.supabase.co/rest/v1/profiles?select=id,full_name,avatar_url,role,created_at&order=created_at.desc',
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
        }
      );
      if (response.ok) {
        const restData = await response.json();
        if (Array.isArray(restData) && restData.length > 0) {
          console.log('[HostDashboard] Successfully fetched', restData.length, 'profiles via REST fallback');
          setSignedUsers(restData as SignedUserProfile[]);
          try {
            localStorage.setItem('tariqah_cached_signed_users', JSON.stringify(restData));
          } catch (e) {}
          return;
        }
      }
    } catch (err) {
      console.warn('[HostDashboard] Failed to fetch signed users via primary attempt:', err);
      // Secondary fallback attempt
      try {
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodmlncW1jcGRieWpxY3VwbGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTY3OTgsImV4cCI6MjA4NTUzMjc5OH0.fRGQuX2zc7PnssNa8pufWM7KnCXF80hThAJ45KD6nj0';
        const response = await fetch(
          'https://ahvigqmcpdbyjqcuplhu.supabase.co/rest/v1/profiles?select=id,full_name,avatar_url,role,created_at&order=created_at.desc',
          {
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
            },
          }
        );
        if (response.ok) {
          const restData = await response.json();
          if (Array.isArray(restData)) {
            setSignedUsers(restData as SignedUserProfile[]);
            try {
              localStorage.setItem('tariqah_cached_signed_users', JSON.stringify(restData));
            } catch (e) {}
          }
        }
      } catch (e) {}
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    refreshBannedUsers();
    fetchSignedUsers();

    const channel = supabase
      .channel('public:profiles_dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchSignedUsers();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => {});
    };
  }, []);

  // Re-fetch users whenever users tab is activated
  useEffect(() => {
    if (activeTab === 'users') {
      fetchSignedUsers();
    }
  }, [activeTab]);

  // Fetch past sessions when history tab is opened
  useEffect(() => {
    if (activeTab === 'history') {
      const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
          const { data, error } = await supabase
            .from('live_sessions')
            .select('id, title, state, started_at, ended_at, created_at')
            .order('created_at', { ascending: false })
            .limit(15);

          if (!error && data) {
            setPastSessions(data as PastSession[]);
          }
        } catch (err) {
          console.warn('[HostDashboard] Failed to fetch session history:', err);
        } finally {
          setIsLoadingHistory(false);
        }
      };

      fetchHistory();
    }
  }, [activeTab]);

  // Permission rules:
  // 1. A user can never ban themselves
  // 2. An ADMIN can never be banned by anyone
  // 3. A HOST cannot ban another HOST (only an ADMIN can ban a HOST)
  // 4. A HOST can ban a regular USER (Listener)
  // 5. An ADMIN can ban any HOST or USER
  const canModerateTarget = (target: SignedUserProfile) => {
    if (!user) return false;
    if (target.id === user.id) return false; // Self moderation forbidden
    if (target.role === 'ADMIN') return false; // Admins are immune
    if (target.role === 'HOST') {
      return user.role === 'ADMIN'; // Only Admin can ban/moderate a Host
    }
    // Target is 'USER'
    return user.role === 'HOST' || user.role === 'ADMIN';
  };

  const handleUnban = (bUser: BannedUser) => {
    if (bUser.role === 'HOST' && user?.role !== 'ADMIN') {
      alert('Permission Denied: A host cannot unban another host. Only an Admin can unban a Host.');
      return;
    }
    if (window.confirm(`Unban ${bUser.name}? They will be able to join future live broadcasts.`)) {
      presenceManager.unbanListener(bUser.id);
      refreshBannedUsers();
      setActionNotice(`✅ Unbanned ${bUser.name}`);
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleBanFromUsersList = (u: SignedUserProfile) => {
    if (!canModerateTarget(u)) {
      if (u.role === 'HOST') {
        alert('Permission Denied: A host cannot ban another host. Only an Admin can ban a Host.');
      } else {
        alert('Permission Denied: You do not have permission to moderate this user.');
      }
      return;
    }
    if (window.confirm(`Permanently ban ${u.full_name}? They will not be able to join broadcasts.`)) {
      presenceManager.banListener(u.id, u.full_name, u.avatar_url || undefined, u.role);
      refreshBannedUsers();
      setActionNotice(`🚫 Permanently banned ${u.full_name}`);
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleUnbanFromUsersList = (u: SignedUserProfile) => {
    if (!canModerateTarget(u)) {
      if (u.role === 'HOST') {
        alert('Permission Denied: A host cannot unban another host. Only an Admin can unban a Host.');
      } else {
        alert('Permission Denied: You do not have permission to moderate this user.');
      }
      return;
    }
    if (window.confirm(`Unban ${u.full_name}? They will be able to join future live broadcasts.`)) {
      presenceManager.unbanListener(u.id);
      refreshBannedUsers();
      setActionNotice(`✅ Unbanned ${u.full_name}`);
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleBack = () => {
    setView(previousHostView || 'host-prelive');
  };

  const tabs = [
    { id: 'users', label: 'Registered Users', icon: Users, count: signedUsers.length },
    { id: 'banned', label: 'Banned Users', icon: ShieldBan, count: bannedUsers.length },
    { id: 'history', label: 'Broadcast History', icon: BarChart3, count: pastSessions.length },
    { id: 'recordings', label: 'Recordings', icon: Disc, count: recordings.length },
  ] as const;

  const filteredUsers = signedUsers.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    );
  });

  const filteredBanned = bannedUsers.filter((bUser) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      bUser.name.toLowerCase().includes(q) ||
      (bUser.role || '').toLowerCase().includes(q)
    );
  });

  const filteredHistory = pastSessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.title || '').toLowerCase().includes(q) ||
      (s.state || '').toLowerCase().includes(q)
    );
  });

  const filteredRecordings = recordings.filter((rec) => {
    if (rec.sizeBytes <= 0) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (rec.title || '').toLowerCase().includes(q) ||
      rec.filename.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full flex flex-col md:flex-row min-h-screen bg-slate-50 relative overflow-x-hidden">
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity animate-in fade-in duration-200"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      {/* Persistent Left Sidebar on Desktop / Off-canvas Slide Drawer on Mobile */}
      <aside
        className={`fixed md:sticky top-0 bottom-0 left-0 z-50 md:z-10 w-72 md:w-64 lg:w-72 bg-white border-r border-slate-200/90 shadow-2xl md:shadow-none flex flex-col transform md:transform-none transition-transform duration-300 ease-in-out shrink-0 h-screen ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Mobile Sidebar Brand Header */}
        <div className="md:hidden bg-[#15803D] text-white p-4 pt-safe flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center p-1 shadow-inner">
              <img src="/assets/sign-in-logo.webp" alt="Tariqah al-Raj" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">Tariqah al-Raj</h2>
              <p className="text-[11px] text-emerald-100">Host Dashboard</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 text-emerald-100 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Desktop Sidebar Top: Bold Visible Back Element */}
        <div className="hidden md:flex items-center px-4 py-3.5 border-b border-slate-200/80 bg-white shrink-0">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-slate-900 hover:text-[#15803D] font-bold text-sm transition-colors cursor-pointer group"
            title="Back"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-slate-900 group-hover:text-[#15803D] stroke-[2.5] group-hover:-translate-x-0.5 transition-transform" />
            <span>Back</span>
          </button>
        </div>

        {/* Host Profile Info on Top (no back button) */}
        {user && (
          <div className="p-3.5 md:p-4 bg-slate-50/70 border-b border-slate-200/80 shrink-0 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#15803D] text-white font-bold flex items-center justify-center text-xs shadow-xs overflow-hidden shrink-0">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.fullName} className="w-full h-full object-cover" />
              ) : (
                getInitials(user.fullName)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">{user.fullName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                  {user.role}
                </span>
                {session.state === 'LIVE' && (
                  <span className="text-[10px] font-bold text-rose-600 animate-pulse">
                    ● Live
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto py-3 px-2 md:px-3 space-y-1">
          <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Navigation
          </div>

          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsSidebarOpen(false);
                  setSearchQuery('');
                  setIsSearchOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition cursor-pointer text-left ${
                  isActive
                    ? 'bg-emerald-50 text-[#15803D] font-bold shadow-2xs'
                    : 'text-slate-700 hover:bg-slate-100/80 font-medium'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`p-1.5 rounded-lg shrink-0 ${isActive ? 'bg-[#15803D] text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold truncate">{tab.label}</span>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${
                  isActive
                    ? 'bg-[#15803D] text-white'
                    : tab.id === 'banned' && tab.count > 0
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-200/80 text-slate-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 min-h-screen">
        {/* Mobile Green Header Bar */}
        <div className="md:hidden w-full bg-[#15803D] text-white px-3.5 pt-safe pb-3 shrink-0 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2 -ml-1">
            <button
              type="button"
              onClick={handleBack}
              className="p-1.5 text-white hover:text-emerald-100 hover:bg-white/10 rounded-full transition cursor-pointer shrink-0"
              aria-label="Back"
              title="Back"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h1 className="text-base font-bold tracking-tight text-white leading-tight">
              Host Dashboard
            </h1>
          </div>

          {session.state === 'LIVE' && (
            <div className="flex items-center gap-1.5 bg-red-600 text-white px-2.5 py-0.5 rounded-full text-xs font-bold animate-pulse">
              <Radio className="w-3.5 h-3.5" />
              <span>LIVE</span>
            </div>
          )}
        </div>

        {/* Desktop Topbar */}
        <header className="hidden md:grid grid-cols-3 items-center px-8 py-3.5 bg-white border-b border-slate-200/80 sticky top-0 z-20 shadow-2xs">
          {/* Left: Section Title */}
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold text-slate-900 leading-tight truncate">
              {activeTab === 'users' ? 'User Directory' : activeTab === 'banned' ? 'Banned Accounts' : activeTab === 'history' ? 'Broadcast History' : 'Recordings Library'}
            </h1>
          </div>

          {/* Center: Search Bar in the Middle */}
          <div className="flex justify-center w-full">
            <div className="relative w-full max-w-sm lg:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${tabs.find((t) => t.id === activeTab)?.label.toLowerCase()}...`}
                className="w-full bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 focus:border-[#15803D] rounded-xl pl-9 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none transition shadow-2xs"
                style={{ outline: 'none', boxShadow: 'none' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                  title="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Right: Actions / Live Status */}
          <div className="flex items-center justify-end gap-3">
            {session.state === 'LIVE' && (
              <div className="flex items-center gap-1.5 bg-red-600 text-white px-2.5 py-1 rounded-full text-xs font-bold animate-pulse shadow-xs">
                <Radio className="w-3.5 h-3.5" />
                <span>LIVE</span>
              </div>
            )}
          </div>
        </header>

        {/* Scrollable Dashboard Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full space-y-5">
          {/* Action Notice Toast */}
          {actionNotice && (
            <div className="bg-[#0F2942] text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-md border border-slate-700 text-center animate-in fade-in duration-150">
              {actionNotice}
            </div>
          )}

          {/* Mobile Navigation Header Under Topbar with Burger Menu & Dynamic Search */}
          <div className="md:hidden">
            {isSearchOpen ? (
              <div className="w-full flex items-center gap-2.5 bg-white border border-slate-200/90 shadow-2xs rounded-xl px-3 py-2 transition animate-in fade-in duration-150">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${tabs.find((t) => t.id === activeTab)?.label.toLowerCase()}...`}
                  className="flex-1 w-full bg-transparent border-0 outline-none text-xs text-slate-800 placeholder-slate-400 p-0 m-0 focus:outline-none focus:ring-0 focus:border-0"
                  style={{
                    outline: 'none',
                    boxShadow: 'none',
                    border: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQuery('');
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition cursor-pointer shrink-0"
                  aria-label="Close search"
                  title="Close search"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between pb-1">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex items-center gap-2.5 text-slate-800 hover:text-[#15803D] transition cursor-pointer -ml-1 p-1 rounded-xl hover:bg-slate-200/50"
                  aria-label="Open menu"
                  title="Open menu"
                >
                  <div className="p-1.5 bg-white border border-slate-200/90 shadow-2xs rounded-lg text-slate-700">
                    <Menu className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold text-[#0F2942]">
                    {tabs.find((t) => t.id === activeTab)?.label} ({tabs.find((t) => t.id === activeTab)?.count})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(true);
                    setTimeout(() => searchInputRef.current?.focus(), 60);
                  }}
                  className="p-2 text-slate-600 hover:text-[#15803D] transition rounded-xl hover:bg-slate-200/50 cursor-pointer"
                  title="Search"
                  aria-label="Search"
                >
                  <Search className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* ================= TAB 0: ALL REGISTERED USERS ================= */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {isLoadingUsers ? (
                <div className="py-16 flex justify-center items-center text-slate-400 text-xs">
                  Loading registered users...
                </div>
              ) : signedUsers.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 border border-slate-200/80 text-center shadow-xs">
                  <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">No registered users found</p>
                </div>
              ) : (
                <>
                  {/* Desktop Full-Width Users Data Table */}
                  <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-[#15803D]" />
                        <h3 className="text-sm font-bold text-slate-900">User Directory</h3>
                      </div>
                      <span className="text-xs text-slate-500 font-medium">
                        Showing {filteredUsers.length} of {signedUsers.length} users
                      </span>
                    </div>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-3.5 px-6">User</th>
                          <th className="py-3.5 px-6">Role</th>
                          <th className="py-3.5 px-6">Joined Date</th>
                          <th className="py-3.5 px-6">Status</th>
                          <th className="py-3.5 px-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredUsers.map((u) => {
                          const isCurrentUser = u.id === user?.id;
                          const isBanned = presenceManager.isUserBanned(u.id);
                          const isTargetAdmin = u.role === 'ADMIN';
                          const isTargetHost = u.role === 'HOST';
                          const canModerate = canModerateTarget(u);

                          return (
                            <tr key={u.id} className="hover:bg-slate-50/70 transition">
                              <td className="py-3.5 px-6">
                                <div className="flex items-center gap-3">
                                  {u.avatar_url ? (
                                    <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                                      <img src={u.avatar_url} alt={u.full_name} className="w-full h-full object-cover" />
                                    </div>
                                  ) : (
                                    <div className="w-9 h-9 rounded-full bg-emerald-100 border border-emerald-200 text-[#15803D] flex items-center justify-center font-bold text-xs shrink-0">
                                      {getInitials(u.full_name)}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-900">{u.full_name || 'Anonymous User'}</span>
                                    {isCurrentUser && (
                                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-full">
                                        You
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              <td className="py-3.5 px-6">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                                    u.role === 'ADMIN'
                                      ? 'bg-purple-100 text-purple-800'
                                      : u.role === 'HOST'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {u.role === 'USER' ? 'Listener' : u.role}
                                </span>
                              </td>

                              <td className="py-3.5 px-6 text-slate-500">
                                {new Date(u.created_at).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </td>

                              <td className="py-3.5 px-6">
                                {isBanned ? (
                                  <span className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                                    Banned
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                    Active
                                  </span>
                                )}
                              </td>

                              <td className="py-3.5 px-6 text-right">
                                {isCurrentUser ? (
                                  <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                                    Current Account
                                  </span>
                                ) : isTargetAdmin ? (
                                  <span className="text-[11px] font-bold text-purple-800 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200">
                                    Admin Protected
                                  </span>
                                ) : isBanned ? (
                                  canModerate ? (
                                    <button
                                      type="button"
                                      onClick={() => handleUnbanFromUsersList(u)}
                                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#15803D] border border-emerald-200 text-xs font-bold rounded-xl transition cursor-pointer"
                                    >
                                      Unban User
                                    </button>
                                  ) : (
                                    <span className="text-slate-400 text-xs">Restricted</span>
                                  )
                                ) : canModerate ? (
                                  <button
                                    type="button"
                                    onClick={() => handleBanFromUsersList(u)}
                                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold rounded-xl transition cursor-pointer"
                                  >
                                    Ban User
                                  </button>
                                ) : isTargetHost ? (
                                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                                    Co-Host
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-xs">None</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Users List */}
                  <div className="md:hidden space-y-2">
                    {filteredUsers.map((u) => {
                      const isCurrentUser = u.id === user?.id;
                      const isBanned = presenceManager.isUserBanned(u.id);
                      const isTargetAdmin = u.role === 'ADMIN';
                      const isTargetHost = u.role === 'HOST';
                      const canModerate = canModerateTarget(u);

                      return (
                        <div
                          key={u.id}
                          className="bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            {u.avatar_url ? (
                              <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                                <img src={u.avatar_url} alt={u.full_name} className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 text-[#15803D] flex items-center justify-center font-bold text-xs shrink-0">
                                {getInitials(u.full_name)}
                              </div>
                            )}

                            <div className="truncate">
                              <div className="flex items-center gap-1.5 truncate">
                                <h4 className="text-xs font-bold text-slate-900 truncate">
                                  {u.full_name || 'Anonymous User'}
                                </h4>
                                {isCurrentUser && (
                                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-full shrink-0">
                                    You
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 mt-0.5">
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md uppercase tracking-wider ${
                                    u.role === 'ADMIN'
                                      ? 'bg-purple-100 text-purple-800'
                                      : u.role === 'HOST'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {u.role === 'USER' ? 'Listener' : u.role}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Joined {new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {isCurrentUser ? (
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                                You
                              </span>
                            ) : isTargetAdmin ? (
                              <span className="text-[10px] font-bold text-purple-800 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">
                                Admin
                              </span>
                            ) : isBanned ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                  Banned
                                </span>
                                {canModerate && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnbanFromUsersList(u)}
                                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-[#15803D] border border-emerald-200 text-xs font-bold rounded-xl transition cursor-pointer"
                                  >
                                    Unban
                                  </button>
                                )}
                              </div>
                            ) : canModerate ? (
                              <button
                                type="button"
                                onClick={() => handleBanFromUsersList(u)}
                                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200 text-xs font-bold rounded-xl transition cursor-pointer"
                              >
                                Ban
                              </button>
                            ) : isTargetHost ? (
                              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                                Host
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-slate-400 px-2 py-1">
                                Listener
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================= TAB 1: BANNED USERS ================= */}
          {activeTab === 'banned' && (
            <div className="space-y-4">
              {bannedUsers.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 border border-slate-200/80 text-center shadow-xs flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#15803D] mb-2">
                    <CheckCircle className="w-6 h-6 stroke-[2]" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-700">No Banned Users</h3>
                  <p className="text-[11px] text-slate-400 mt-1">All participants currently have active broadcast privileges.</p>
                </div>
              ) : (
                <>
                  {/* Desktop Banned Users Table */}
                  <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldBan className="w-4 h-4 text-rose-600" />
                        <h3 className="text-sm font-bold text-slate-900">Banned Accounts List</h3>
                      </div>
                      <span className="text-xs text-slate-500 font-medium">{filteredBanned.length} restricted</span>
                    </div>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-3.5 px-6">User</th>
                          <th className="py-3.5 px-6">Original Role</th>
                          <th className="py-3.5 px-6">Banned Date</th>
                          <th className="py-3.5 px-6">Status</th>
                          <th className="py-3.5 px-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredBanned.map((bUser) => (
                          <tr key={bUser.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3.5 px-6">
                              <div className="flex items-center gap-3">
                                {bUser.avatarUrl ? (
                                  <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                                    <img src={bUser.avatarUrl} alt={bUser.name} className="w-full h-full object-cover" />
                                  </div>
                                ) : (
                                  <div className="w-9 h-9 rounded-full bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center font-bold text-xs shrink-0">
                                    {getInitials(bUser.name)}
                                  </div>
                                )}
                                <span className="font-bold text-slate-900">{bUser.name}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-6">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider bg-slate-100 text-slate-700">
                                {bUser.role || 'USER'}
                              </span>
                            </td>

                            <td className="py-3.5 px-6 text-slate-500">
                              {new Date(bUser.bannedAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>

                            <td className="py-3.5 px-6">
                              <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                                Prohibited
                              </span>
                            </td>

                            <td className="py-3.5 px-6 text-right">
                              {bUser.role === 'HOST' && user?.role !== 'ADMIN' ? (
                                <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-md">
                                  Admin Only
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleUnban(bUser)}
                                  className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-[#15803D] border border-emerald-200 text-xs font-bold rounded-xl transition cursor-pointer"
                                >
                                  Unban Account
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Banned Users List */}
                  <div className="md:hidden space-y-2">
                    {filteredBanned.map((bUser) => (
                      <div
                        key={bUser.id}
                        className="bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          {bUser.avatarUrl ? (
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                              <img src={bUser.avatarUrl} alt={bUser.name} className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center font-bold text-xs shrink-0">
                              {getInitials(bUser.name)}
                            </div>
                          )}
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-bold text-slate-900 truncate">
                                {bUser.name}
                              </h4>
                              {bUser.role && (
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md uppercase tracking-wider ${
                                    bUser.role === 'HOST'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {bUser.role}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Banned on {new Date(bUser.bannedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {bUser.role === 'HOST' && user?.role !== 'ADMIN' ? (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-md shrink-0">
                            Admin Only
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUnban(bUser)}
                            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-[#15803D] border border-emerald-200 text-xs font-bold rounded-xl transition cursor-pointer shrink-0"
                          >
                            Unban
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================= TAB 2: BROADCAST HISTORY ================= */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {isLoadingHistory ? (
                <div className="py-16 flex justify-center items-center text-slate-400 text-xs">
                  Loading history...
                </div>
              ) : pastSessions.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 border border-slate-200/80 text-center shadow-xs">
                  <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">No broadcast history yet</p>
                </div>
              ) : (
                <>
                  {/* Desktop Broadcast History Table */}
                  <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#15803D]" />
                        <h3 className="text-sm font-bold text-slate-900">Past Broadcast Sessions</h3>
                      </div>
                      <span className="text-xs text-slate-500 font-medium">{filteredHistory.length} sessions</span>
                    </div>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-3.5 px-6">Broadcast Title</th>
                          <th className="py-3.5 px-6">Status</th>
                          <th className="py-3.5 px-6">Started At</th>
                          <th className="py-3.5 px-6 text-right">Ended At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredHistory.map((s) => {
                          const isCurrent = s.id === session.id && session.state === 'LIVE';
                          return (
                            <tr key={s.id} className="hover:bg-slate-50/70 transition">
                              <td className="py-3.5 px-6">
                                <div className="flex items-center gap-2 font-bold text-slate-900">
                                  <span>{s.title || 'Zikr Session'}</span>
                                  {isCurrent && (
                                    <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full animate-pulse">
                                      LIVE NOW
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3.5 px-6">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    s.state === 'LIVE'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {s.state}
                                </span>
                              </td>

                              <td className="py-3.5 px-6 text-slate-500">
                                {s.started_at
                                  ? new Date(s.started_at).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : new Date(s.created_at).toLocaleDateString()}
                              </td>

                              <td className="py-3.5 px-6 text-right text-slate-500">
                                {s.ended_at
                                  ? new Date(s.ended_at).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : isCurrent
                                  ? 'In progress'
                                  : 'Completed'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile History Cards */}
                  <div className="md:hidden space-y-2">
                    {filteredHistory.map((s) => {
                      const isCurrent = s.id === session.id && session.state === 'LIVE';
                      const dateStr = s.started_at
                        ? new Date(s.started_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : new Date(s.created_at).toLocaleDateString();

                      return (
                        <div
                          key={s.id}
                          className={`bg-white rounded-2xl p-3.5 border shadow-xs flex items-center justify-between ${
                            isCurrent ? 'border-red-300 bg-red-50/20' : 'border-slate-200/80'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-bold text-slate-900">{s.title || 'Zikr Session'}</h4>
                              {isCurrent && (
                                <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.2 rounded-full">
                                  LIVE NOW
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
                          </div>

                          <div className="text-right">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                s.state === 'LIVE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {s.state}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================= TAB 3: RECORDINGS ================= */}
          {activeTab === 'recordings' && (
            <div className="space-y-4">
              {isLoadingRecordings ? (
                <div className="py-16 flex justify-center items-center text-slate-400 text-xs">
                  Loading recordings...
                </div>
              ) : recordings.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 border border-slate-200/80 text-center shadow-xs">
                  <Disc className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">No recordings found</p>
                  <p className="text-[11px] text-slate-400 mt-1">Recordings made during live broadcasts will appear here.</p>
                </div>
              ) : (
                <>
                  {/* Desktop Recordings Table */}
                  <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Disc className="w-4 h-4 text-[#15803D]" />
                        <h3 className="text-sm font-bold text-slate-900">Recordings Library</h3>
                      </div>
                      <span className="text-xs text-slate-500 font-medium">{filteredRecordings.length} audio files saved</span>
                    </div>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-3.5 px-6">Play</th>
                          <th className="py-3.5 px-6">Recording Title</th>
                          <th className="py-3.5 px-6">Created Date</th>
                          <th className="py-3.5 px-6">Duration</th>
                          <th className="py-3.5 px-6">File Size</th>
                          <th className="py-3.5 px-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredRecordings.map((rec) => {
                          const isCurrent = activeRecording?.id === rec.id;
                          const sizeMb = (rec.sizeBytes / 1024 / 1024).toFixed(1);
                          const dateFormatted = new Date(rec.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });

                          return (
                            <tr
                              key={rec.id}
                              className={`hover:bg-slate-50/70 transition ${isCurrent ? 'bg-emerald-50/40' : ''}`}
                            >
                              <td className="py-3.5 px-6">
                                <button
                                  type="button"
                                  onClick={() => handlePlayToggle(rec)}
                                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-xs transition cursor-pointer bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white"
                                  title={isCurrent && isPlaying ? 'Pause' : 'Play recording'}
                                  aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
                                >
                                  {isCurrent && isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                                </button>
                              </td>

                              <td className="py-3.5 px-6">
                                <div className="font-bold text-slate-900">{rec.title || 'Zikr Session'}</div>
                                {isCurrent && (
                                  <div className="flex items-center gap-1.5 text-xs text-[#15803D] font-medium mt-1">
                                    <Volume2 className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                                    <span>
                                      {isPlaying ? 'Playing' : 'Paused'} • {formatAudioTime(currentTime)} / {formatAudioTime(duration || rec.durationSeconds || 0)}
                                    </span>
                                  </div>
                                )}
                              </td>

                              <td className="py-3.5 px-6 text-slate-500">{dateFormatted}</td>

                              <td className="py-3.5 px-6">
                                {rec.durationSeconds > 0 ? (
                                  <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                                    {formatDuration(rec.durationSeconds)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>

                              <td className="py-3.5 px-6 text-slate-500 font-mono">{sizeMb} MB</td>

                              <td className="py-3.5 px-6 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {isCurrent ? (
                                    <button
                                      type="button"
                                      onClick={handleClosePlayer}
                                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                                      title="Close player"
                                      aria-label="Close"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRecording(rec)}
                                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                                      title="Delete recording"
                                      aria-label="Delete"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Recordings Cards */}
                  <div className="md:hidden space-y-2 pb-24">
                    <p className="text-[11px] text-slate-400 px-1">Tip: Swipe left to delete</p>
                    {filteredRecordings.map((rec) => {
                      const isCurrent = activeRecording?.id === rec.id;
                      const sizeMb = (rec.sizeBytes / 1024 / 1024).toFixed(1);
                      const dateFormatted = new Date(rec.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <SwipeableMobileRecordingCard
                          key={rec.id}
                          rec={rec}
                          isCurrent={isCurrent}
                          isPlaying={isPlaying}
                          currentTime={currentTime}
                          duration={duration}
                          playbackSpeed={playbackSpeed}
                          isMuted={isMuted}
                          dateFormatted={dateFormatted}
                          sizeMb={sizeMb}
                          onPlayToggle={() => handlePlayToggle(rec)}
                          onSeek={handleSeek}
                          onSkip={handleSkip}
                          onCycleSpeed={handleCycleSpeed}
                          onToggleMute={handleToggleMute}
                          onClosePlayer={handleClosePlayer}
                          onDelete={handleDeleteRecording}
                        />
                      );
                    })}
                  </div>

                  {/* Desktop Persistent Bottom Player Bar */}
                  {activeRecording && (
                    <div className="hidden md:block fixed bottom-4 left-4 right-4 md:left-72 md:right-8 z-40 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl p-3.5 md:p-4 text-slate-800 transition-all">
                      <div className="flex flex-col gap-2">
                        {/* Top row: Info & Secondary Controls */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 truncate min-w-0">
                            <div className="w-8 h-8 rounded-full bg-emerald-100 text-[#15803D] flex items-center justify-center shrink-0">
                              <Disc className="w-4 h-4 text-[#15803D]" />
                            </div>
                            <div className="truncate">
                              <div className="text-xs font-bold text-slate-900 truncate">
                                {activeRecording.title || 'Live Recording'}
                              </div>
                              <div className="text-[10px] text-slate-500 flex items-center gap-2">
                                <span>{(activeRecording.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                                <span>•</span>
                                <span>{new Date(activeRecording.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={handleCycleSpeed}
                              className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition cursor-pointer"
                              title="Playback Speed"
                            >
                              {playbackSpeed}x
                            </button>
                            <button
                              type="button"
                              onClick={handleToggleMute}
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                              title={isMuted ? 'Unmute' : 'Mute'}
                            >
                              {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={handleClosePlayer}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                              title="Close player"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Bottom row: Skip -10s, Play/Pause, Skip +10s, Time, Scrubber */}
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleSkip(-10)}
                            className="p-1.5 text-slate-600 hover:text-[#15803D] hover:bg-emerald-50 rounded-lg transition cursor-pointer flex items-center gap-0.5 text-xs font-semibold shrink-0"
                            title="Rewind 10s"
                          >
                            <RotateCcw className="w-4 h-4" />
                            <span className="text-[10px] hidden sm:inline">-10s</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handlePlayToggle(activeRecording)}
                            className="w-9 h-9 rounded-full bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white flex items-center justify-center shadow-xs transition cursor-pointer shrink-0"
                            title={isPlaying ? 'Pause' : 'Play'}
                          >
                            {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSkip(10)}
                            className="p-1.5 text-slate-600 hover:text-[#15803D] hover:bg-emerald-50 rounded-lg transition cursor-pointer flex items-center gap-0.5 text-xs font-semibold shrink-0"
                            title="Forward 10s"
                          >
                            <span className="text-[10px] hidden sm:inline">+10s</span>
                            <RotateCw className="w-4 h-4" />
                          </button>

                          <span className="text-xs font-mono font-medium text-slate-600 shrink-0 w-11 text-right">
                            {formatAudioTime(currentTime)}
                          </span>

                          <div className="flex-1 flex items-center">
                            <input
                              type="range"
                              min="0"
                              max={duration > 0 ? duration : (activeRecording.durationSeconds || 1)}
                              step="0.1"
                              value={currentTime}
                              onChange={(e) => handleSeek(parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#15803D] hover:bg-slate-300 transition"
                            />
                          </div>

                          <span className="text-xs font-mono font-medium text-slate-400 shrink-0 w-11">
                            {formatAudioTime(duration > 0 ? duration : (activeRecording.durationSeconds || 0))}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

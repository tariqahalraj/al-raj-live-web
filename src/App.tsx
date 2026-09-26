import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/shared/stores/app-store';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { SignUpScreen } from '@/features/auth/SignUpScreen';
import { ForgotPasswordScreen } from '@/features/auth/ForgotPasswordScreen';
import { ListenerPreviewScreen } from '@/features/listener/ListenerPreviewScreen';
import { HostPreLiveScreen } from '@/features/host/HostPreLiveScreen';
import { HostLiveScreen } from '@/features/host/HostLiveScreen';
import { HostDashboardScreen } from '@/features/host/HostDashboardScreen';
import { ListenerLiveScreen } from '@/features/listener/ListenerLiveScreen';
import { recoveryCoordinator, presenceManager, stopBackgroundLiveService } from '@/features/live-session';
import { webRtcSessionManager } from '@/features/media-transport';
import { audioEngine } from '@/features/audio-engine';
import { supabase } from '@/core/supabase-client';
import { startNativeLiveMonitoring } from '@/features/live-session/live-background-service';
import { getAssetUrl } from '@/shared/utils/asset';
import { profileCache } from '@/shared/utils/profile-cache';
import { otaManager } from '@/core/updater/ota-manager';
import { OtaBanner } from '@/core/updater/OtaBanner';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error?.message || 'An unexpected error occurred' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Caught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4 text-2xl">
            ⚠️
          </div>
          <h2 className="text-lg font-bold text-[#0F2942] mb-2">Display Notice</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            {this.state.errorMessage}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, errorMessage: '' });
              window.location.reload();
            }}
            className="px-6 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold text-sm rounded-xl shadow-sm transition cursor-pointer"
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const App: React.FC = () => {
  const { currentView, setOnline, setUser, setView, user } = useAppStore();
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Strict route protection: enforce role boundaries and authentication
  useEffect(() => {
    if (isAuthChecking) return;

    if (!user) {
      if (currentView !== 'sign-in' && currentView !== 'sign-up' && currentView !== 'forgot-password') {
        setView('sign-in');
      }
      return;
    }

    const isHost = user.role === 'HOST' || user.role === 'ADMIN';

    if (isHost) {
      if (currentView === 'sign-in' || currentView === 'sign-up' || currentView === 'forgot-password' || currentView === 'listener-preview' || currentView === 'listener-live') {
        setView('host-prelive');
      }
    } else {
      if (currentView === 'host-prelive' || currentView === 'host-live' || currentView === 'host-dashboard') {
        // Demoted or switched from Host to Listener: cleanly release host hardware and sessions
        try {
          webRtcSessionManager.teardown();
          audioEngine.dispose();
          presenceManager.leavePresence();
          stopBackgroundLiveService();
          const activeSession = useAppStore.getState().session;
          if (activeSession.id) {
            Promise.resolve(supabase.rpc('end_host_session', { p_session_id: activeSession.id })).catch(() => {});
            Promise.resolve(supabase.rpc('finalize_host_session', { p_session_id: activeSession.id })).catch(() => {});
          }
        } catch {}
        useAppStore.getState().updateSession({
          state: 'ENDED',
          id: '',
          isKicked: false,
          elapsedSeconds: 0,
          cloudflareSessionId: undefined,
          cloudflareTrackId: undefined,
        });
        setView('listener-preview');
      } else if (currentView === 'sign-in' || currentView === 'sign-up' || currentView === 'forgot-password') {
        setView('listener-preview');
      }
    }
  }, [user, currentView, setView, isAuthChecking]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initialize global recovery coordinator
    recoveryCoordinator.init();

    // Arm native background live session monitor
    startNativeLiveMonitoring();

    // Initialize OTA Live Updates (Cloudflare R2)
    otaManager.initialize();

    // Helper to resolve user role and hydrate state reliably from localStorage cache and public.profiles
    const hydrateUser = async (sessionUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }) => {
      try {
        // 1. Check local cache for instant zero-latency hydration
        let cachedProfile: { fullName?: string; avatarUrl?: string; role?: 'USER' | 'HOST' | 'ADMIN' } | null = null;
        try {
          const cachedStr = localStorage.getItem(`tariqah_profile_${sessionUser.id}`);
          if (cachedStr) {
            cachedProfile = JSON.parse(cachedStr);
          }
        } catch {}

        const initialRole = cachedProfile?.role || (sessionUser.user_metadata?.role as 'USER' | 'HOST' | 'ADMIN') || 'USER';
        const initialIsHost = initialRole === 'HOST' || initialRole === 'ADMIN';

        setUser({
          id: sessionUser.id,
          email: sessionUser.email || '',
          fullName: cachedProfile?.fullName || (sessionUser.user_metadata?.full_name as string) || (initialIsHost ? 'Our Murshid' : 'Member'),
          avatarUrl: cachedProfile?.avatarUrl || (sessionUser.user_metadata?.avatar_url as string),
          role: initialRole,
        });

        // Instantly route to appropriate home screen if currently on auth screen
        const currentViewNow = useAppStore.getState().currentView;
        if (currentViewNow === 'sign-in' || currentViewNow === 'sign-up' || currentViewNow === 'forgot-password') {
          setView(initialIsHost ? 'host-prelive' : 'listener-preview');
        }

        // 2. Fetch fresh profile from database asynchronously without blocking or evicting on timeout
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, role')
          .eq('id', sessionUser.id)
          .maybeSingle();

        if (profile) {
          const role = (profile?.role as 'USER' | 'HOST' | 'ADMIN' | undefined) || 'USER';
          const isHost = role === 'HOST' || role === 'ADMIN';

          const updatedUser = {
            id: sessionUser.id,
            email: sessionUser.email || '',
            fullName: profile?.full_name || (sessionUser.user_metadata?.full_name as string) || (isHost ? 'Our Murshid' : 'Member'),
            avatarUrl: profile?.avatar_url || (sessionUser.user_metadata?.avatar_url as string),
            role,
          };

          setUser(updatedUser);
          profileCache.set({
            id: updatedUser.id,
            fullName: updatedUser.fullName,
            avatarUrl: updatedUser.avatarUrl,
            role: updatedUser.role,
          });

          try {
            localStorage.setItem(`tariqah_profile_${sessionUser.id}`, JSON.stringify({
              fullName: updatedUser.fullName,
              avatarUrl: updatedUser.avatarUrl,
              role: updatedUser.role,
            }));
          } catch {}

          const activeView = useAppStore.getState().currentView;
          if (activeView === 'sign-in' || activeView === 'sign-up' || activeView === 'forgot-password') {
            setView(isHost ? 'host-prelive' : 'listener-preview');
          }
        }
      } catch (err) {
        console.warn('[App] Notice during user hydration (session preserved):', err);
      }
    };

    const splashStartTime = Date.now();
    const MIN_SPLASH_MS = 250; // Ultra-fast 250ms web splash screen for instant website experience

    let isFinished = false;
    const finishAuth = () => {
      if (!isFinished) {
        isFinished = true;
        const elapsed = Date.now() - splashStartTime;
        const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
        setTimeout(() => {
          setIsAuthChecking(false);
        }, remaining);
      }
    };

    // Safety fallback timeout: fallback after 4s if network hangs
    const safetyTimer = setTimeout(() => {
      console.log('[App] Auth check safety timer fired — dismissing splash screen');
      finishAuth();
    }, 4000);

    // 1. Check existing session on boot
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (session?.user) {
          await hydrateUser(session.user);
        } else {
          setUser(null);
          setView('sign-in');
        }
      })
      .catch((err) => {
        console.warn('[App] Error getting session on boot:', err);
        setUser(null);
        setView('sign-in');
      })
      .finally(() => {
        clearTimeout(safetyTimer);
        finishAuth();
      });

    // 2. Listen to real-time auth changes (sign in, sign out, token refresh)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED')) {
        await hydrateUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setView('sign-in');
      }
    });

    // 3. Listen to realtime profile updates from backend (role changes)
    const profileChannel = supabase
      .channel('public_profiles_role_sync')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const updated = payload.new as { id?: string; role?: 'USER' | 'HOST' | 'ADMIN'; full_name?: string };
          const currentUser = useAppStore.getState().user;
          if (currentUser && updated?.id === currentUser.id && updated.role) {
            console.log('[App] Backend profile role updated in realtime to:', updated.role);
            const isHost = updated.role === 'HOST' || updated.role === 'ADMIN';
            useAppStore.getState().setUser({
              ...currentUser,
              role: updated.role,
              fullName: updated.full_name || currentUser.fullName,
            });
            const activeView = useAppStore.getState().currentView;
            if (!isHost && (activeView === 'host-prelive' || activeView === 'host-live' || activeView === 'host-dashboard')) {
              // Real-time demotion from Host to Listener: cleanly release host hardware and session
              try {
                webRtcSessionManager.teardown();
                audioEngine.dispose();
                presenceManager.leavePresence();
                stopBackgroundLiveService();
                const activeSession = useAppStore.getState().session;
                if (activeSession.id) {
                  Promise.resolve(supabase.rpc('end_host_session', { p_session_id: activeSession.id })).catch(() => {});
                  Promise.resolve(supabase.rpc('finalize_host_session', { p_session_id: activeSession.id })).catch(() => {});
                }
              } catch {}
              useAppStore.getState().updateSession({
                state: 'ENDED',
                id: '',
                isKicked: false,
                elapsedSeconds: 0,
                cloudflareSessionId: undefined,
                cloudflareTrackId: undefined,
              });
              useAppStore.getState().setView('listener-preview');
            } else if (activeView === 'sign-in' || activeView === 'sign-up' || activeView === 'forgot-password') {
              useAppStore.getState().setView(isHost ? 'host-prelive' : 'listener-preview');
            }
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      authListener?.subscription.unsubscribe();
      profileChannel.unsubscribe();
      recoveryCoordinator.destroy();
    };
  }, [setOnline, setUser, setView]);

  // Global live session elapsed timer — active across all screen views
  useEffect(() => {
    const timer = setInterval(() => {
      const state = useAppStore.getState();
      if (state.session.state === 'LIVE') {
        state.incrementElapsed();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Bind persistent audio element after auth check completes and DOM mounts
  useEffect(() => {
    if (!isAuthChecking) {
      const audioEl = document.getElementById('remote-audio-element') as HTMLAudioElement;
      if (audioEl) {
        webRtcSessionManager.attachAudioElement(audioEl);
      }
    }
  }, [isAuthChecking]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center justify-center text-center animate-in fade-in duration-300">
          <div className="w-36 h-36 mb-4 relative flex items-center justify-center drop-shadow-md">
            <img
              src={getAssetUrl('assets/sign-in-logo.webp')}
              alt="Tariqah al-Raj Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-[#0F2942] tracking-tight">
            Tariqah al-Raj
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Live Audio Platform
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 flex flex-col relative w-full overflow-x-hidden">
        {currentView === 'sign-in' && <SignInScreen />}
        {currentView === 'sign-up' && <SignUpScreen />}
        {currentView === 'forgot-password' && <ForgotPasswordScreen />}
        {currentView === 'listener-preview' && <ListenerPreviewScreen />}
        {currentView === 'host-prelive' && <HostPreLiveScreen />}
        {currentView === 'host-live' && <HostLiveScreen />}
        {currentView === 'host-dashboard' && <HostDashboardScreen />}
        {currentView === 'listener-live' && <ListenerLiveScreen />}

        {/* Permanent DOM audio element for instantaneous WebRTC audio output */}
        <audio
          id="remote-audio-element"
          autoPlay
          playsInline
          style={{ position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', opacity: 1, zIndex: -50, pointerEvents: 'none' }}
        />

        {/* In-App OTA Live Update Floating Notification */}
        <OtaBanner />
      </div>
    </ErrorBoundary>
  );
};

export default App;

import { create } from 'zustand';
import { Participant } from '@/features/live-session/participants-data';

export type AppView = 
  | 'sign-in' 
  | 'sign-up' 
  | 'listener-preview' 
  | 'host-prelive' 
  | 'host-live' 
  | 'listener-live'
  | 'host-dashboard';

export type Language = 'en' | 'bn';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  role: 'USER' | 'HOST' | 'ADMIN';
}

export type TransmissionMode = 'standard' | 'low-data';

export interface LiveSessionState {
  id: string;
  title: string;
  hostName: string;
  hostAvatarUrl?: string;
  state: 'STARTING' | 'LIVE' | 'ENDING' | 'ENDED' | 'FAILED';
  mediaGeneration: number;
  listenerCount: number;
  elapsedSeconds: number;
  isHostMuted: boolean;
  isRecording: boolean;
  selectedMicrophone: string;
  audioQuality: string;
  transmissionMode: TransmissionMode;
  autoAdaptiveBitrate: boolean;
  isAutoDowngraded: boolean;
  cloudflareSessionId?: string;
  cloudflareTrackId?: string;
  isKicked?: boolean;
  isBanned?: boolean;
}

interface AppStore {
  currentView: AppView;
  previousHostView: 'host-prelive' | 'host-live';
  language: Language;
  isOnline: boolean;
  user: UserProfile | null;
  session: LiveSessionState;
  participants: Participant[];

  setView: (view: AppView) => void;
  setPreviousHostView: (view: 'host-prelive' | 'host-live') => void;
  setLanguage: (lang: Language) => void;
  setOnline: (online: boolean) => void;
  setUser: (user: UserProfile | null) => void;
  updateSession: (partial: Partial<LiveSessionState>) => void;
  setParticipants: (participants: Participant[]) => void;
  setListenerCount: (count: number) => void;
  endSession: () => void;
  setTransmissionMode: (mode: TransmissionMode) => void;
  setAutoAdaptiveBitrate: (enabled: boolean) => void;
  toggleHostMute: () => void;
  toggleRecording: () => void;
  incrementElapsed: () => void;
  resetElapsed: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentView: 'sign-in',
  previousHostView: 'host-prelive',
  language: 'en',
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  user: null,
  session: {
    id: '',
    title: 'Tariqah al-Raj Live Session',
    hostName: '',
    hostAvatarUrl: undefined,
    state: 'ENDED',
    mediaGeneration: 1,
    listenerCount: 0,
    elapsedSeconds: 0,
    isHostMuted: false,
    isRecording: false,
    isKicked: false,
    isBanned: false,
    selectedMicrophone: 'Default (Internal Mic)',
    audioQuality: 'Optimized for speech (Recommended)',
    transmissionMode: 'standard',
    autoAdaptiveBitrate: true,
    isAutoDowngraded: false,
  },
  participants: [],

  setView: (view) => set({ currentView: view }),
  setPreviousHostView: (view) => set({ previousHostView: view }),
  setLanguage: (lang) => set({ language: lang }),
  setOnline: (online) => set({ isOnline: online }),
  setUser: (user) => set({ user }),
  updateSession: (partial) =>
    set((state) => ({ session: { ...state.session, ...partial } })),
  setParticipants: (participants) => set({ participants }),
  setListenerCount: (count) =>
    set((state) => ({ session: { ...state.session, listenerCount: count } })),
  setTransmissionMode: (mode) =>
    set((state) => ({
      session: {
        ...state.session,
        transmissionMode: mode,
        isAutoDowngraded: false,
      },
    })),
  setAutoAdaptiveBitrate: (enabled) =>
    set((state) => ({
      session: { ...state.session, autoAdaptiveBitrate: enabled },
    })),
  endSession: () =>
    set((state) => ({
      session: {
        ...state.session,
        id: '',
        state: 'ENDED',
        elapsedSeconds: 0,
        isRecording: false,
        isKicked: false,
        listenerCount: 0,
        isAutoDowngraded: false,
      },
      participants: [],
      currentView:
        state.user?.role === 'HOST' || state.user?.role === 'ADMIN'
          ? 'host-prelive'
          : 'listener-preview',
    })),
  toggleHostMute: () =>
    set((state) => ({
      session: { ...state.session, isHostMuted: !state.session.isHostMuted },
    })),
  toggleRecording: () =>
    set((state) => ({
      session: { ...state.session, isRecording: !state.session.isRecording },
    })),
  incrementElapsed: () =>
    set((state) => ({
      session: { ...state.session, elapsedSeconds: state.session.elapsedSeconds + 1 },
    })),
  resetElapsed: () =>
    set((state) => ({
      session: { ...state.session, elapsedSeconds: 0 },
    })),
}));

import React, { useEffect, useState } from 'react';
import { Download, Clock } from 'lucide-react';
import { otaManager, OtaState } from './ota-manager';
import { useAppStore } from '@/shared/stores/app-store';
import { getAssetUrl } from '@/shared/utils/asset';

export const OtaBanner: React.FC = () => {
  const [state, setState] = useState<OtaState>(otaManager.getState());
  const [isDismissed, setIsDismissed] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const { language } = useAppStore();
  const isBn = language === 'bn';

  useEffect(() => {
    const unsubscribe = otaManager.subscribe((newState) => {
      setState(newState);
      if (newState.status === 'ready' || newState.status === 'available') {
        setIsDismissed(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleUpdate = () => {
    setIsApplying(true);
    setTimeout(async () => {
      try {
        await otaManager.reloadApp();
      } catch (err) {
        console.error('Failed to reload for OTA:', err);
        window.location.reload();
      }
    }, 700);
  };

  // Full-Screen Minimalist Transition when applying update with horizontal progress bar
  if (isApplying) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#0A192F] flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-200">
        <div className="flex flex-col items-center max-w-xs w-full text-center">
          <img
            src={getAssetUrl('assets/sign-in-logo.webp')}
            alt="Tariqah al-Raj"
            className="w-16 h-16 object-contain mb-4 animate-pulse duration-700"
          />
          <h3 className="text-white text-base font-bold tracking-tight mb-1">
            {isBn ? 'অ্যাপ আপডেট হচ্ছে...' : 'Updating Application...'}
          </h3>
          <p className="text-slate-400 text-xs mb-4">
            {isBn ? 'অনুগ্রহ করে অপেক্ষা করুন' : 'Please wait a moment'}
          </p>
          {/* Horizontal Progress Bar */}
          <div className="w-48 bg-slate-800 h-1.5 rounded-full overflow-hidden relative">
            <div className="absolute top-0 bottom-0 left-0 w-1/2 bg-[#15803D] rounded-full animate-horizontal-progress" />
          </div>
        </div>
      </div>
    );
  }

  if (isDismissed || (state.status !== 'ready' && state.status !== 'downloading' && state.status !== 'available')) {
    return null;
  }

  const isDownloading = state.status === 'downloading';

  return (
    <div
      aria-label={isBn ? 'অ্যাপ আপডেট' : 'App Update'}
      style={{
        top: 'calc(max(env(safe-area-inset-top, 0px), 16px) + 56px)',
        bottom: 0,
        height: 'calc(100dvh - max(env(safe-area-inset-top, 0px), 16px) - 56px)',
      }}
      className="fixed inset-x-0 z-40 bg-slate-50 overflow-y-auto overscroll-contain animate-banner-in flex flex-col"
    >
      <div
        className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-between items-center px-5 select-none"
        style={{
          minHeight: 'calc(100dvh - max(env(safe-area-inset-top, 0px), 16px) - 56px)',
          paddingTop: '1.75rem',
          paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Top: Circular Download Illustration & Title */}
        <div className="w-full flex flex-col items-center">
          <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-[#E8F7EE] flex items-center justify-center p-3 shrink-0">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#D1F2DE] flex items-center justify-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#15803D] flex items-center justify-center shadow-lg shadow-emerald-900/15">
                <Download className="w-8 h-8 sm:w-9 sm:h-9 text-white stroke-[2.5]" />
              </div>
            </div>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-[#0F2942] tracking-tight text-center mt-3">
            {isBn ? 'অ্যাপ আপডেট এসেছে' : 'App Update Available'}
          </h2>
        </div>

        {/* Middle: Main White Card */}
        <div className="w-full bg-white rounded-2xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-4 sm:p-5 my-3 text-left">
          {/* Version Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isBn ? `ভার্সন ${state.availableVersion || '1.2.10'}` : `Version ${state.availableVersion || '1.2.10'}`}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isBn ? `বর্তমান ভার্সন: ${state.currentVersion || '1.2.9'}` : `Current version: ${state.currentVersion || '1.2.9'}`}
              </p>
            </div>
            <span className="bg-[#E8F7EE] text-[#16A34A] text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
              {isBn ? 'নতুন আপডেট' : 'New Update'}
            </span>
          </div>

          <hr className="border-t border-slate-100 my-3" />

          {/* What's New - Exact dynamic release items */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 mb-2">
              {isBn ? 'নতুন কি আছে:' : "What's new"}
            </h4>
            <ul className="space-y-1.5">
              {(state.whatsNew && state.whatsNew.length > 0 ? state.whatsNew : [
                'New Over-The-Air (OTA) live update delivery system',
                'Enhanced background live audio stability & reconnection',
                'Real-time listener profile & role synchronization',
                'Refined Tariqah al-Raj spiritual portal UI design',
              ]).map((item, idx) => (
                <li key={idx} className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#15803D] shrink-0" />
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom: Action Controls */}
        <div className="w-full">
          {isDownloading ? (
            /* Horizontal Progress Bar for download (NO loading spinner) */
            <div className="w-full bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm text-left">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1.5">
                <span>{isBn ? 'আপডেট ডাউনলোড হচ্ছে...' : 'Downloading update...'}</span>
                <span className="text-[#15803D] font-bold">{state.sizeFormatted || '~721 KB'}</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden relative">
                <div className="absolute top-0 bottom-0 left-0 w-1/2 bg-[#15803D] rounded-full animate-horizontal-progress" />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleUpdate}
              className="w-full py-3.5 px-5 bg-[#15803D] hover:bg-[#166534] active:scale-[0.99] text-white font-bold text-sm rounded-xl shadow-md shadow-emerald-900/15 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Download className="w-4 h-4 text-white stroke-[2.5]" />
              <span>{isBn ? 'ডাউনলোড আপডেট' : 'Download Update'}</span>
            </button>
          )}

          <p className="text-[11px] text-slate-400 font-medium text-center mt-2">
            {state.sizeFormatted || '~721 KB'} • {isBn ? 'ওয়াইফাই রিকমেন্ডেড' : 'Wi-Fi recommended'}
          </p>

          <div className="flex items-center gap-3 my-2.5 w-full">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium">OR</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="w-full py-3.5 px-4 bg-[#F0F7FF] hover:bg-[#E4F2FE] active:scale-[0.99] text-[#0F2942] font-semibold text-sm rounded-xl border border-[#BAE0FD]/60 shadow-sm flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Clock className="w-4 h-4 text-[#0284C7]/80 stroke-[2.2]" />
            <span>{isBn ? 'পরে মনে করিয়ে দিন' : 'Remind Me Later'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};



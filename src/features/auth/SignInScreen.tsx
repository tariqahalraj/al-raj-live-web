import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { supabase } from '@/core/supabase-client';
import { getAssetUrl } from '@/shared/utils/asset';

export const SignInScreen: React.FC = () => {
  const { setView, language, setLanguage, setUser } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);


  const handleSignInSuccess = async (userId: string, userEmail: string, metadata?: Record<string, unknown>) => {
    try {
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, role')
        .eq('id', userId)
        .maybeSingle();

      if (profErr) {
        console.warn('[SignIn] Failed to fetch profile:', profErr);
      }

      const role = (profile?.role as 'USER' | 'HOST' | 'ADMIN' | undefined) || 'USER';
      const isHost = role === 'HOST' || role === 'ADMIN';

      setUser({
        id: userId,
        email: userEmail,
        fullName: profile?.full_name || (metadata?.full_name as string) || (isHost ? 'Our Murshid' : 'Brother in Islam'),
        avatarUrl: profile?.avatar_url || (metadata?.avatar_url as string),
        role,
      });

      if (isHost) {
        setView('host-prelive');
      } else {
        setView('listener-preview');
      }
    } catch (err) {
      console.warn('[SignIn] Error in handleSignInSuccess:', err);
      setView('listener-preview');
    }
  };

  const performSignIn = async (signInEmail: string, signInPass: string) => {
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: signInEmail.trim(),
        password: signInPass,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (data.user) {
        await handleSignInSuccess(data.user.id, data.user.email || signInEmail, data.user.user_metadata);
      }
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'An unexpected error occurred during sign in.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }
    await performSignIn(email, password);
  };



  return (
    <>
      {/* Mobile View (< md): 100% Authentic Full-Screen Native Mobile Experience matching backup */}
      <div className="w-full flex md:hidden flex-col min-h-screen bg-white px-4 pt-safe pb-safe relative justify-between overflow-y-auto">
        {/* Top Bar: Language Switcher */}
        <div className="w-full flex justify-end items-center pt-2 relative z-20">
          <button
            type="button"
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-1 text-sm font-medium text-slate-800 hover:text-slate-600 transition cursor-pointer"
          >
            <span>{language === 'bn' ? 'বাংলা' : 'English'}</span>
            <ChevronDown className="w-4 h-4 text-slate-600" />
          </button>

          {showLangMenu && (
            <div className="absolute right-0 top-8 bg-white border border-slate-100 rounded-lg shadow-lg py-1 w-28 z-30">
              <button
                type="button"
                onClick={() => { setLanguage('en'); setShowLangMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
              >
                English
              </button>
              <button
                type="button"
                onClick={() => { setLanguage('bn'); setShowLangMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
              >
                বাংলা
              </button>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="w-full flex-1 flex flex-col justify-center my-auto pb-4">
          {/* Circular Gold Emblem & Branding */}
          <div className="flex flex-col items-center text-center mb-5">
            <div className="w-36 h-36 mb-3 relative drop-shadow-md flex items-center justify-center">
              <img
                src={getAssetUrl('assets/sign-in-logo.webp')}
                alt="Tariqah al-Raj Logo"
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = getAssetUrl('assets/app-logo.png');
                }}
              />
            </div>
            <h1 className="text-2xl font-bold text-[#0F2942] tracking-tight mb-0.5">
              Tariqah al-Raj
            </h1>
            <p className="text-sm font-normal text-slate-500">
              Live Audio Platform
            </p>
          </div>

          {/* Error Notification */}
          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span className="leading-tight">{errorMessage}</span>
            </div>
          )}

          {/* Sign In Form */}
          <form onSubmit={handleSubmit} className="w-full space-y-4" autoComplete="off">
            {/* Email Input */}
            <div className="w-full space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Email
              </label>
              <div className="w-full flex items-center px-4 py-3.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                <Mail className="w-5 h-5 text-slate-700 mr-3 shrink-0" />
                <input
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full text-base text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="w-full space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Password
              </label>
              <div className="w-full flex items-center px-4 py-3.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                <Lock className="w-5 h-5 text-slate-700 mr-3 shrink-0" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full text-base text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-600 hover:text-slate-800 transition ml-2 cursor-pointer p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Forgot Password */}
            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                onClick={async () => {
                  if (!email) {
                    setErrorMessage('Please enter your email address first.');
                    return;
                  }
                  const { error } = await supabase.auth.resetPasswordForEmail(email);
                  if (error) setErrorMessage(error.message);
                  else alert('Password reset email sent.');
                }}
                className="text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 px-4 bg-[#0B2545] hover:bg-[#081d37] active:bg-[#06162a] text-white font-semibold rounded-xl shadow-xs transition duration-150 text-base tracking-wide mt-2 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>
        </div>

        {/* Footer Navigation */}
        <div className="w-full text-center pb-6 pt-2">
          <p className="text-sm text-slate-600">
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => setView('sign-up')}
              className="text-[#15803D] font-medium hover:underline inline-block cursor-pointer ml-1"
            >
              Register
            </button>
          </p>
        </div>
      </div>

      {/* Desktop View (>= md): Contained Split Hero + Form Card */}
      <div className="hidden md:flex min-h-screen bg-slate-100/80 items-center justify-center p-6 lg:p-10 relative overflow-y-auto">
        <div className="w-full min-h-[580px] max-w-4xl lg:max-w-[960px] bg-white rounded-3xl shadow-xl border border-slate-200/80 flex flex-row overflow-hidden my-auto">
          {/* Desktop Left Hero Panel */}
          <div className="flex flex-col justify-between items-center text-center p-8 lg:p-12 bg-gradient-to-br from-[#0B2545] via-[#0F2942] to-[#15803D] text-white w-5/12 shrink-0 relative overflow-hidden select-none">
            {/* Background Highlights */}
            <div className="absolute -top-24 -left-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="w-full h-4" />

            {/* Center Hero Information */}
            <div className="relative z-10 flex flex-col items-center justify-center text-center my-auto py-6">
              <div className="w-36 h-36 lg:w-44 lg:h-44 mb-6 relative drop-shadow-2xl flex items-center justify-center">
                <img
                  src={getAssetUrl('assets/sign-in-logo.webp')}
                  alt="Tariqah al-Raj Logo"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = getAssetUrl('assets/app-logo.png');
                  }}
                />
              </div>
              <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight leading-tight">
                Tariqah al-Raj
              </h1>
              <p className="text-xs lg:text-sm text-emerald-100/90 mt-2 font-medium tracking-wide">
                Live Audio Platform
              </p>
            </div>

            <div className="relative z-10 text-[11px] text-emerald-100/60 text-center">
              © {new Date().getFullYear()} Tariqah al-Raj
            </div>
          </div>

          {/* Desktop Right Column: Form Panel */}
          <div className="w-7/12 bg-white flex flex-col justify-between p-8 lg:p-12 overflow-y-auto">
            {/* Top Bar: Language Switcher */}
            <div className="w-full flex justify-end items-center relative z-20">
              <button
                type="button"
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100/80 px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                <span>{language === 'bn' ? 'বাংলা' : 'English'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {showLangMenu && (
                <div className="absolute right-0 top-9 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-28 z-30">
                  <button
                    type="button"
                    onClick={() => { setLanguage('en'); setShowLangMenu(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLanguage('bn'); setShowLangMenu(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
                  >
                    বাংলা
                  </button>
                </div>
              )}
            </div>

            {/* Desktop Form Content */}
            <div className="w-full max-w-sm mx-auto my-auto py-4">
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  Sign In
                </h2>
              </div>

              {errorMessage && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span className="leading-tight">{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="w-full space-y-4" autoComplete="off">
                <div className="w-full space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Email Address
                  </label>
                  <div className="w-full flex items-center px-3.5 py-3 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                    <Mail className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                    <input
                      type="email"
                      autoComplete="off"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    />
                  </div>
                </div>

                <div className="w-full space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <div className="w-full flex items-center px-3.5 py-3 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                    <Lock className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-slate-600 transition ml-2 cursor-pointer p-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!email) {
                        setErrorMessage('Please enter your email address first.');
                        return;
                      }
                      const { error } = await supabase.auth.resetPasswordForEmail(email);
                      if (error) setErrorMessage(error.message);
                      else alert('Password reset email sent.');
                    }}
                    className="text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 px-4 bg-[#0B2545] hover:bg-[#081d37] active:bg-[#06162a] text-white font-bold rounded-xl shadow-xs transition duration-150 text-xs tracking-wide mt-2 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing In...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </form>
            </div>

            <div className="w-full text-center pb-4 pt-2">
              <p className="text-xs text-slate-600">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setView('sign-up')}
                  className="text-[#15803D] font-bold hover:underline inline-block cursor-pointer ml-1"
                >
                  Register Account
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

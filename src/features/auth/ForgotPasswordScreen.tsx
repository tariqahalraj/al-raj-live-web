import React, { useState, useEffect } from 'react';
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { supabase } from '@/core/supabase-client';

export const ForgotPasswordScreen: React.FC = () => {
  const { setView, language } = useAppStore();

  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'success'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

  const isBn = language === 'bn';

  // Resend countdown timer for Step 2
  useEffect(() => {
    let interval: number | null = null;
    if (step === 'otp' && resendTimer > 0) {
      interval = window.setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [step, resendTimer]);

  // Step 1: Request 6-digit OTP code to email
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage(isBn ? 'অনুগ্রহ করে আপনার ইমেল দিন।' : 'Please enter your email address.');
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setStep('otp');
      setResendTimer(60);
      setCanResend(false);
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || (isBn ? 'কোড পাঠাতে ব্যর্থ হয়েছে।' : 'Failed to send verification code.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Resend OTP
  const handleResend = async () => {
    if (!canResend || isLoading) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      setResendTimer(60);
      setCanResend(false);
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'Failed to resend code.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify 6-digit OTP code
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = otp.trim();
    if (cleanOtp.length < 6) {
      setErrorMessage(isBn ? 'অনুগ্রহ করে সঠিক ৬-সংখ্যার কোড দিন।' : 'Please enter the complete 6-digit code.');
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: cleanOtp,
        type: 'recovery',
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setStep('password');
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || (isBn ? 'কোড যাচাই ব্যর্থ হয়েছে।' : 'Code verification failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Set new password
  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setErrorMessage(isBn ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' : 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage(isBn ? 'পাসওয়ার্ড দুটি মিলছে না।' : 'Passwords do not match.');
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setStep('success');
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || (isBn ? 'পাসওয়ার্ড আপডেট ব্যর্থ হয়েছে।' : 'Failed to update password.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 md:bg-slate-100 flex flex-col justify-between items-center p-4 sm:p-6 md:p-10 overflow-y-auto">
      {/* Top Header / Back Button */}
      <div className="w-full max-w-md md:max-w-lg flex items-center justify-between pt-safe pb-4">
        <button
          type="button"
          onClick={() => setView('sign-in')}
          className="inline-flex items-center gap-2 text-slate-700 hover:text-slate-900 text-sm font-semibold transition cursor-pointer p-2 rounded-xl hover:bg-slate-200/60"
        >
          <ArrowLeft className="w-5 h-5 text-slate-700" />
          <span>{isBn ? 'সাইন ইন এ ফিরুন' : 'Back to Sign In'}</span>
        </button>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md md:max-w-lg bg-white rounded-3xl shadow-xl border border-slate-200/80 p-6 sm:p-8 my-auto flex flex-col items-center">
        {/* Step Icon */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-[#15803D] border border-emerald-100 flex items-center justify-center mb-5 shadow-xs">
          {step === 'success' ? (
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          ) : (
            <KeyRound className="w-8 h-8 text-[#15803D]" />
          )}
        </div>

        {/* ================= STEP 1: ENTER EMAIL ================= */}
        {step === 'email' && (
          <div className="w-full text-center">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isBn ? 'পাসওয়ার্ড রিসেট' : 'Reset Password'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 mb-6 max-w-xs mx-auto leading-relaxed">
              {isBn
                ? 'আপনার অ্যাকাউন্টের ইমেল লিখুন। আমরা একটি ওটিপি যাচাইকরণ কোড পাঠাবো।'
                : 'Enter your account email address and we will send you a verification code.'}
            </p>

            {errorMessage && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs text-left">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-tight">{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSendCode} className="space-y-4 text-left" autoComplete="off">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  {isBn ? 'ইমেল ঠিকানা' : 'Email Address'}
                </label>
                <div className="w-full flex items-center px-4 py-3.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                  <Mail className="w-5 h-5 text-slate-600 mr-3 shrink-0" />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full text-base text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 px-4 bg-[#0B2545] hover:bg-[#081d37] active:bg-[#06162a] text-white font-semibold rounded-xl shadow-xs transition duration-150 text-base tracking-wide cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isBn ? 'পাঠানো হচ্ছে...' : 'Sending Code...'}</span>
                  </>
                ) : (
                  <span>{isBn ? '৬-সংখ্যার কোড পাঠান' : 'Send 6-Digit Code'}</span>
                )}
              </button>
            </form>
          </div>
        )}

        {/* ================= STEP 2: VERIFY OTP ================= */}
        {step === 'otp' && (
          <div className="w-full text-center">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isBn ? 'যাচাইকরণ কোড' : 'Enter Verification Code'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 mb-6 max-w-xs mx-auto leading-relaxed">
              {isBn ? (
                <>আমরা <strong>{email}</strong> এ একটি ৬-সংখ্যার কোড পাঠিয়েছি।</>
              ) : (
                <>We sent a 6-digit code to <strong className="text-slate-700">{email}</strong>.</>
              )}
            </p>

            {errorMessage && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs text-left">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-tight">{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-5" autoComplete="off">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 text-left">
                  {isBn ? 'ওটিপি যাচাইকরণ কোড' : 'Verification OTP Code'}
                </label>
                <div className="w-full flex items-center justify-center px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="12345678"
                    className="w-full text-center font-mono text-2xl font-bold tracking-widest text-slate-900 placeholder:text-slate-300 bg-transparent outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || otp.length < 6}
                className="w-full py-4 px-4 bg-[#0B2545] hover:bg-[#081d37] active:bg-[#06162a] text-white font-semibold rounded-xl shadow-xs transition duration-150 text-base tracking-wide cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isBn ? 'যাচাই করা হচ্ছে...' : 'Verifying...'}</span>
                  </>
                ) : (
                  <span>{isBn ? 'কোড যাচাই করুন' : 'Verify Code'}</span>
                )}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => setStep('email')}
                  className="text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  {isBn ? 'ইমেল পরিবর্তন করুন' : 'Change email'}
                </button>

                {canResend ? (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isLoading}
                    className="text-[#15803D] font-bold hover:underline cursor-pointer"
                  >
                    {isBn ? 'পুনরায় পাঠান' : 'Resend Code'}
                  </button>
                ) : (
                  <span className="text-slate-400 font-mono">
                    {isBn ? 'পুনরায় কোড' : 'Resend in'} {resendTimer}s
                  </span>
                )}
              </div>
            </form>
          </div>
        )}

        {/* ================= STEP 3: SET NEW PASSWORD ================= */}
        {step === 'password' && (
          <div className="w-full text-center">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isBn ? 'নতুন পাসওয়ার্ড দিন' : 'Set New Password'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 mb-6 max-w-xs mx-auto leading-relaxed">
              {isBn
                ? 'আপনার অ্যাকাউন্টের জন্য কমপক্ষে ৬ অক্ষরের নতুন পাসওয়ার্ড নির্বাচন করুন।'
                : 'Choose a new password for your account (minimum 6 characters).'}
            </p>

            {errorMessage && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs text-left">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-tight">{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSetNewPassword} className="space-y-4 text-left" autoComplete="off">
              {/* New Password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  {isBn ? 'নতুন পাসওয়ার্ড' : 'New Password'}
                </label>
                <div className="w-full flex items-center px-4 py-3.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                  <Lock className="w-5 h-5 text-slate-600 mr-3 shrink-0" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={isBn ? 'কমপক্ষে ৬ অক্ষর' : 'At least 6 characters'}
                    className="w-full text-base text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-slate-500 hover:text-slate-800 transition ml-2 cursor-pointer p-1"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  {isBn ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm New Password'}
                </label>
                <div className="w-full flex items-center px-4 py-3.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                  <Lock className="w-5 h-5 text-slate-600 mr-3 shrink-0" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={isBn ? 'পুনরায় পাসওয়ার্ড লিখুন' : 'Re-enter password'}
                    className="w-full text-base text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 px-4 bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white font-semibold rounded-xl shadow-xs transition duration-150 text-base tracking-wide cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75 mt-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isBn ? 'সংরক্ষণ করা হচ্ছে...' : 'Saving Password...'}</span>
                  </>
                ) : (
                  <span>{isBn ? 'পাসওয়ার্ড আপডেট করুন' : 'Update Password'}</span>
                )}
              </button>
            </form>
          </div>
        )}

        {/* ================= STEP 4: SUCCESS ================= */}
        {step === 'success' && (
          <div className="w-full text-center py-2">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isBn ? 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে!' : 'Password Updated!'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 mb-6 max-w-xs mx-auto leading-relaxed">
              {isBn
                ? 'আপনার নতুন পাসওয়ার্ড সংরক্ষণ করা হয়েছে। এখন নতুন পাসওয়ার্ড দিয়ে সাইন ইন করতে পারবেন।'
                : 'Your password has been successfully reset. You can now sign in with your new password.'}
            </p>

            <button
              type="button"
              onClick={() => setView('sign-in')}
              className="w-full py-4 px-4 bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white font-semibold rounded-xl shadow-xs transition duration-150 text-base tracking-wide cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{isBn ? 'সাইন ইন করুন' : 'Sign In Now'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="w-full text-center pt-4 pb-safe text-xs text-slate-400">
        © {new Date().getFullYear()} Tariqah al-Raj
      </div>
    </div>
  );
};

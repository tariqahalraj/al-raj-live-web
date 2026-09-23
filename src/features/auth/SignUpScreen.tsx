import React, { useState } from 'react';
import { ChevronLeft, Camera, User, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, Plus } from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { supabase } from '@/core/supabase-client';
import { SafeTextInput } from '@/shared/components/SafeTextInput';

export const SignUpScreen: React.FC = () => {
  const { setView, setUser } = useAppStore();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setErrorMessage('Profile photo must be less than 5MB.');
        return;
      }
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter a password.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (data.user) {
        let uploadedAvatarUrl: string | undefined = undefined;

        // 1. Upload photo to Supabase storage 'avatars' bucket
        if (avatarFile) {
          try {
            const ext = avatarFile.name.split('.').pop() || 'jpg';
            const filePath = `${data.user.id}/avatar.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, avatarFile, { upsert: true, contentType: avatarFile.type });

            if (!uploadError) {
              const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);
              uploadedAvatarUrl = publicUrl;
            } else {
              console.warn('[SignUp] Storage upload notice:', uploadError.message);
            }
          } catch (storageErr) {
            console.warn('[SignUp] Storage upload exception:', storageErr);
          }
        }

        // 2. Update profiles table with USER role, full_name and avatar_url
        await supabase
          .from('profiles')
          .update({
            role: 'USER',
            full_name: fullName.trim(),
            ...(uploadedAvatarUrl ? { avatar_url: uploadedAvatarUrl } : {}),
          })
          .eq('id', data.user.id);

        setUser({
          id: data.user.id,
          email: data.user.email || email,
          fullName: fullName.trim() || 'Member',
          avatarUrl: uploadedAvatarUrl || avatarPreview || undefined,
          role: 'USER',
        });
        setView('listener-preview');
      }
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'An unexpected error occurred during account creation.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Mobile View (< md): 100% Authentic Full-Screen Native Mobile Experience */}
      <div className="flex md:hidden flex-col min-h-screen bg-white px-6 pt-safe pb-safe max-w-md mx-auto justify-between w-full">
        {/* Top Bar with Back Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setView('sign-in')}
            className="p-1 -ml-1 text-slate-800 hover:text-slate-600 transition cursor-pointer"
            aria-label="Go back"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col justify-center my-auto py-2 w-full">
          {/* Title Header */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-[#0F2942] tracking-tight mb-1">
              Create Account
            </h1>
            <p className="text-sm text-slate-500">
              Join Tariqah al-Raj
            </p>
          </div>

          {/* Error Notification */}
          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span className="leading-tight">{errorMessage}</span>
            </div>
          )}

          {/* Profile Photo Selector */}
          <div className="flex flex-col items-center mb-6">
            <label className="relative cursor-pointer group">
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <div className="w-24 h-24 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden transition group-hover:bg-slate-200">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar Preview" className="w-full h-full object-cover" />
                ) : (
                  <Camera className="w-9 h-9 text-slate-500" />
                )}
              </div>
              {/* Green plus badge */}
              <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#15803D] border-2 border-white flex items-center justify-center shadow-xs">
                <Plus className="w-4 h-4 text-white stroke-[3]" />
              </div>
            </label>
            <span className="text-sm font-medium text-slate-800 mt-2">
              Add Profile Photo
            </span>
            <span className="text-xs text-slate-400">
              Optional
            </span>
          </div>

          {/* Form Fields */}
          <form onSubmit={handleSubmit} className="space-y-3.5 w-full" autoComplete="off">
            {/* Full Name */}
            <div className="flex items-center px-3.5 py-3 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
              <User className="w-5 h-5 text-slate-700 mr-3 shrink-0" />
              <SafeTextInput
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                value={fullName}
                onChange={setFullName}
                placeholder="Full Name"
                className="w-full text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
              />
            </div>

            {/* Email */}
            <div className="flex items-center px-3.5 py-3 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
              <Mail className="w-5 h-5 text-slate-700 mr-3 shrink-0" />
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
              />
            </div>

            {/* Password */}
            <div className="flex items-center px-3.5 py-3 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
              <Lock className="w-5 h-5 text-slate-700 mr-3 shrink-0" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-slate-600 hover:text-slate-800 transition ml-2 cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {/* Confirm Password */}
            <div className="flex items-center px-3.5 py-3 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
              <Lock className="w-5 h-5 text-slate-700 mr-3 shrink-0" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm Password"
                className="w-full text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="text-slate-600 hover:text-slate-800 transition ml-2 cursor-pointer"
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-[#0B2545] hover:bg-[#081d37] active:bg-[#06162a] text-white font-semibold rounded-xl shadow-xs transition duration-150 text-sm tracking-wide mt-3 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>Sign Up</span>
              )}
            </button>
          </form>
        </div>

        {/* Footer Navigation */}
        <div className="w-full text-center pb-4 pt-2">
          <p className="text-sm text-slate-600">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => setView('sign-in')}
              className="text-[#15803D] font-medium hover:underline inline-block cursor-pointer ml-1"
            >
              Sign In
            </button>
          </p>
        </div>
      </div>

      {/* Desktop View (>= md): Contained Split Hero + Form Card */}
      <div className="hidden md:flex min-h-screen bg-slate-100/80 items-center justify-center p-6 lg:p-10 relative overflow-y-auto">
        <div className="w-full min-h-[620px] max-w-4xl lg:max-w-[960px] bg-white rounded-3xl shadow-xl border border-slate-200/80 flex flex-row overflow-hidden my-auto">
          {/* Desktop Left Hero Panel */}
          <div className="flex flex-col justify-between items-center text-center p-8 lg:p-12 bg-gradient-to-br from-[#0B2545] via-[#0F2942] to-[#15803D] text-white w-5/12 shrink-0 relative overflow-hidden select-none">
            <div className="absolute -top-24 -left-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="w-full h-4" />

            <div className="relative z-10 flex flex-col items-center justify-center text-center my-auto py-6">
              <div className="w-32 h-32 lg:w-40 lg:h-40 mb-5 relative drop-shadow-2xl flex items-center justify-center">
                <img
                  src="/assets/sign-in-logo.webp"
                  alt="Tariqah al-Raj Logo"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/assets/app-logo.png';
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
            <div className="w-full flex items-center justify-between relative z-20">
              <button
                type="button"
                onClick={() => setView('sign-in')}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100/80 px-3 py-1.5 rounded-lg transition cursor-pointer"
                aria-label="Back to Sign In"
              >
                <ChevronLeft className="w-4 h-4 text-slate-500" />
                <span>Back to Sign In</span>
              </button>
            </div>

            <div className="w-full max-w-sm mx-auto my-auto py-4">
              <div className="mb-5 text-center">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  Create Account
                </h2>
              </div>

              {errorMessage && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span className="leading-tight">{errorMessage}</span>
                </div>
              )}

              {/* Profile Photo Selector */}
              <div className="flex flex-col items-center mb-5">
                <label className="relative cursor-pointer group">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                  <div className="w-20 h-20 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden transition group-hover:bg-slate-200 shadow-2xs">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="Avatar Preview" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-8 h-8 text-slate-400 group-hover:text-slate-600 transition" />
                    )}
                  </div>
                  <div className="absolute bottom-0 right-0 p-1.5 bg-[#15803D] rounded-full text-white shadow-xs group-hover:bg-[#166534] transition">
                    <Camera className="w-3.5 h-3.5" />
                  </div>
                </label>
                <span className="text-[11px] text-slate-500 font-medium mt-1.5">
                  Upload Profile Photo
                </span>
              </div>

              {/* Registration Form */}
              <form onSubmit={handleSubmit} className="w-full space-y-3.5" autoComplete="off">
                <div className="w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Full Name
                  </label>
                  <div className="w-full flex items-center px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                    <User className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                    <SafeTextInput
                      type="text"
                      autoComplete="name"
                      autoCapitalize="words"
                      value={fullName}
                      onChange={setFullName}
                      placeholder="Enter your full name"
                      className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    />
                  </div>
                </div>

                <div className="w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Email Address
                  </label>
                  <div className="w-full flex items-center px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                    <Mail className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    />
                  </div>
                </div>

                <div className="w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <div className="w-full flex items-center px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                    <Lock className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password"
                      className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-slate-600 transition ml-2 cursor-pointer p-1"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Confirm Password
                  </label>
                  <div className="w-full flex items-center px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 focus-within:border-[#15803D] transition">
                    <Lock className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat your password"
                      className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="text-slate-400 hover:text-slate-600 transition ml-2 cursor-pointer p-1"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 px-4 bg-[#0B2545] hover:bg-[#081d37] active:bg-[#06162a] text-white font-bold rounded-xl shadow-xs transition duration-150 text-xs tracking-wide mt-2 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <span>Create Account</span>
                  )}
                </button>
              </form>
            </div>

            <div className="w-full text-center pb-4 pt-2">
              <p className="text-xs text-slate-600">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setView('sign-in')}
                  className="text-[#15803D] font-bold hover:underline inline-block cursor-pointer ml-1"
                >
                  Sign In
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

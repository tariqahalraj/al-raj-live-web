import React, { useState, useEffect } from 'react';
import { X, Camera, Loader2, Check, AlertCircle, User, Mail, Shield, LogOut } from 'lucide-react';
import { useAppStore } from '@/shared/stores/app-store';
import { supabase } from '@/core/supabase-client';
import { getInitials } from '@/features/live-session/participants-data';
import { SafeTextInput } from '@/shared/components/SafeTextInput';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, setUser, setView } = useAppStore();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl || null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Synchronize state and fetch latest profile from Supabase whenever modal opens
  useEffect(() => {
    if (!isOpen || !user?.id) return;

    // Immediately seed with available store values
    setFullName(user.fullName || '');
    setAvatarPreview(user.avatarUrl || null);
    setAvatarFile(null);
    setErrorMsg(null);
    setSuccessMsg(null);

    let isMounted = true;
    setIsLoadingProfile(true);

    const fetchLatestProfile = async () => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.warn('[EditProfileModal] Error fetching profile:', error.message);
          return;
        }

        if (profile && isMounted) {
          const freshAvatar = profile.avatar_url || user.avatarUrl || null;
          const freshName = profile.full_name || user.fullName || '';

          setAvatarPreview(freshAvatar);
          setFullName(freshName);

          // Update store and localStorage if database has newer data
          if (profile.avatar_url !== user.avatarUrl || profile.full_name !== user.fullName) {
            const updatedUser = {
              ...user,
              fullName: freshName,
              avatarUrl: profile.avatar_url || user.avatarUrl,
            };
            setUser(updatedUser);

            try {
              localStorage.setItem(
                `tariqah_profile_${user.id}`,
                JSON.stringify({
                  fullName: updatedUser.fullName,
                  avatarUrl: updatedUser.avatarUrl,
                  role: updatedUser.role,
                })
              );
            } catch {}
          }
        }
      } catch (err) {
        console.warn('[EditProfileModal] Failed to fetch latest profile:', err);
      } finally {
        if (isMounted) {
          setIsLoadingProfile(false);
        }
      }
    };

    fetchLatestProfile();

    return () => {
      isMounted = false;
    };
  }, [isOpen, user?.id]);

  if (!isOpen || !user) return null;

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setErrorMsg('Profile photo must be smaller than 5MB.');
        return;
      }
      setAvatarFile(file);
      setErrorMsg(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!fullName.trim()) {
      setErrorMsg('Full name cannot be empty.');
      return;
    }

    setIsSaving(true);

    try {
      let finalAvatarUrl = avatarPreview || user.avatarUrl;

      // 1. Upload new photo to Supabase storage 'avatars' bucket if changed
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop() || 'jpg';
        const filePath = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, avatarFile, { upsert: true, contentType: avatarFile.type });

        if (uploadError) {
          throw new Error(`Failed to upload photo: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        finalAvatarUrl = publicUrl;
      }

      // 2. Update database public.profiles record
      const updatePayload: { full_name: string; avatar_url?: string } = {
        full_name: fullName.trim(),
      };
      if (finalAvatarUrl) {
        updatePayload.avatar_url = finalAvatarUrl;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id);

      if (updateError) {
        throw new Error(`Failed to update profile: ${updateError.message}`);
      }

      // 3. Update local app store state
      const updatedUser = {
        ...user,
        fullName: fullName.trim(),
        avatarUrl: finalAvatarUrl || user.avatarUrl,
      };
      setUser(updatedUser);

      // 4. Update localStorage cache for instant persistence across reloads
      try {
        localStorage.setItem(`tariqah_profile_${user.id}`, JSON.stringify({
          fullName: updatedUser.fullName,
          avatarUrl: updatedUser.avatarUrl,
          role: updatedUser.role,
        }));
      } catch {}

      setSuccessMsg('Profile updated successfully!');
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || 'An unexpected error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  };

  const isHost = user.role === 'HOST' || user.role === 'ADMIN';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100">
          <h2 className="text-base font-bold text-[#0F2942]">Edit Profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-700 text-xs font-medium">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Avatar Edit Section */}
          <div className="flex flex-col items-center">
            <label className="relative cursor-pointer group">
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center overflow-hidden transition group-hover:border-[#15803D] shadow-inner relative">
                {isLoadingProfile && !avatarPreview ? (
                  <div className="w-full h-full flex items-center justify-center bg-slate-100">
                    <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                  </div>
                ) : avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt={fullName || 'Profile Picture'}
                    className="w-full h-full object-cover"
                    onError={() => {
                      setAvatarPreview(null);
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-emerald-100 text-[#15803D] flex items-center justify-center font-bold text-2xl select-none">
                    {getInitials(fullName || user.email)}
                  </div>
                )}
              </div>
              {/* Camera Icon Overlay */}
              <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#15803D] border-2 border-white flex items-center justify-center shadow-md text-white group-hover:bg-[#166534] transition">
                <Camera className="w-4 h-4" />
              </div>
            </label>
            <span className="text-xs font-semibold text-slate-700 mt-2">
              Change Photo
            </span>
            <span className="text-[10px] text-slate-400">
              Tap to upload new profile picture
            </span>
          </div>

          {/* Full Name Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Full Name
            </label>
            <div className="flex items-center px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-raj-blue/20 focus-within:border-raj-blue transition">
              <User className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
              <SafeTextInput
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                value={fullName}
                onChange={setFullName}
                placeholder="Enter full name"
                className="w-full text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
              />
            </div>
          </div>

          {/* Email (Read-Only) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500">
              Email Address (Account ID)
            </label>
            <div className="flex items-center px-3.5 py-2.5 border border-slate-100 rounded-xl bg-slate-50 text-slate-500">
              <Mail className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
              <span className="text-xs truncate">{user.email}</span>
            </div>
          </div>

          {/* Role Display */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500">
              Platform Role
            </label>
            <div className="flex items-center justify-between px-3.5 py-2 border border-slate-100 rounded-xl bg-slate-50">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-600">Access Level</span>
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                isHost 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                  : 'bg-blue-100 text-blue-800 border border-blue-200'
              }`}>
                {isHost ? 'HOST' : 'LISTENER'}
              </span>
            </div>
          </div>

          {/* Buttons */}
          <div className="pt-2 flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 px-4 bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D] text-white font-semibold rounded-xl text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>

          {/* Sign Out Section */}
          <div className="pt-3 border-t border-slate-100 mt-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await supabase.auth.signOut();
                } catch (e) {
                  console.warn('[EditProfileModal] Sign-out notice:', e);
                } finally {
                  setUser(null);
                  setView('sign-in');
                  onClose();
                }
              }}
              className="w-full py-2.5 px-4 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4 text-rose-600" />
              <span>Sign Out</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'strategist' | 'founder';
  brand_id?: string;
}

interface Brand {
  id: string;
  name: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: string;
}

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();

  // Profile state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [brandName, setBrandName] = useState<string>('');
  const [fullNameInput, setFullNameInput] = useState<string>('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // UI state
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Fetch user profile
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push('/');
          return;
        }

        const { data: profileData, error: profileError } = await supabase
          .from('users_profile')
          .select('id, email, full_name, role, brand_id')
          .eq('id', session.user.id)
          .single();

        if (profileError) throw profileError;

        if (profileData) {
          setProfile(profileData as UserProfile);
          setFullNameInput(profileData.full_name || '');

          // Fetch brand name if brand_id exists
          if (profileData.brand_id) {
            const { data: brandData, error: brandError } = await supabase
              .from('brands')
              .select('name')
              .eq('id', profileData.brand_id)
              .single();

            if (!brandError && brandData) {
              setBrandName(brandData.name);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
        addToast('Failed to load profile', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [supabase, router]);

  // Toast management
  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Handle name save
  const handleSaveName = async () => {
    if (!profile || !fullNameInput.trim()) {
      addToast('Name cannot be empty', 'error');
      return;
    }

    setIsSavingName(true);
    try {
      const { error } = await supabase
        .from('users_profile')
        .update({ full_name: fullNameInput.trim() })
        .eq('id', profile.id);

      if (error) throw error;

      setProfile((prev) =>
        prev ? { ...prev, full_name: fullNameInput.trim() } : null
      );
      setIsEditingName(false);
      addToast('Name updated successfully', 'success');
    } catch (error) {
      console.error('Error updating name:', error);
      addToast('Failed to update name', 'error');
    } finally {
      setIsSavingName(false);
    }
  };

  // Validate password
  const validatePassword = (): string | null => {
    if (!currentPassword) {
      return 'Current password is required';
    }
    if (!newPassword) {
      return 'New password is required';
    }
    if (newPassword.length < 8) {
      return 'New password must be at least 8 characters';
    }
    if (newPassword !== confirmPassword) {
      return 'Passwords do not match';
    }
    if (newPassword === currentPassword) {
      return 'New password must be different from current password';
    }
    return null;
  };

  // Handle password update
  const handleUpdatePassword = async () => {
    const validationError = validatePassword();
    if (validationError) {
      addToast(validationError, 'error');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      // Verify current password by attempting to sign in
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user?.email) {
        throw new Error('No active session');
      }

      // Attempt to verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword,
      });

      if (signInError) {
        addToast('Current password is incorrect', 'error');
        setIsUpdatingPassword(false);
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      // Clear fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast('Password updated successfully', 'success');
    } catch (error) {
      console.error('Error updating password:', error);
      addToast('Failed to update password', 'error');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <Navbar>
        <div
          className="flex items-center justify-center min-h-screen"
          style={{ backgroundColor: '#0A0A0A' }}
        >
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{
              borderColor: 'rgba(200,184,154,0.2)',
              borderTopColor: '#C8B89A',
            }}
          />
        </div>
      </Navbar>
    );
  }

  if (!profile) {
    return (
      <Navbar>
        <div
          className="flex items-center justify-center min-h-screen"
          style={{ backgroundColor: '#0A0A0A' }}
        >
          <div className="text-center">
            <p style={{ color: '#888' }}>Unable to load profile</p>
          </div>
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div
        className="min-h-screen p-6 md:p-8"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#F5F5F8' }}>
              Account Settings
            </h1>
            <p className="text-sm mt-2" style={{ color: '#888' }}>
              Manage your profile and security settings
            </p>
          </div>

          {/* Section 1: Profile Info */}
          <div
            className="rounded-xl p-6 space-y-6"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div>
              <h2 className="text-lg font-semibold" style={{ color: '#F5F5F8' }}>
                Profile Information
              </h2>
              <p className="text-xs mt-1" style={{ color: '#888' }}>
                View and update your account details
              </p>
            </div>

            {/* Email (Read-only) */}
            <div className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: '#888' }}
              >
                Email Address
              </label>
              <div
                className="px-4 py-3 rounded-lg"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <p style={{ color: '#F5F5F8' }}>{profile.email}</p>
              </div>
              <p className="text-xs" style={{ color: '#666' }}>
                Your email address is used for login and cannot be changed
              </p>
            </div>

            {/* Full Name (Editable) */}
            <div className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: '#888' }}
              >
                Full Name
              </label>
              {isEditingName ? (
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={fullNameInput}
                    onChange={(e) => setFullNameInput(e.target.value)}
                    className="flex-1 px-4 py-3 rounded-lg text-sm outline-none transition-all"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(200,184,154,0.3)',
                      color: '#F5F5F8',
                    }}
                    placeholder="Enter your full name"
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={isSavingName}
                    className="px-4 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(135deg, #C8B89A 0%, #A89474 100%)',
                      color: '#0A0A0A',
                    }}
                  >
                    {isSavingName ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingName(false);
                      setFullNameInput(profile.full_name || '');
                    }}
                    className="px-4 py-3 rounded-lg font-medium text-sm transition-all"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#888',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div
                    className="px-4 py-3 rounded-lg flex-1"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <p style={{ color: '#F5F5F8' }}>
                      {profile.full_name || 'Not set'}
                    </p>
                  </div>
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="ml-3 px-4 py-3 rounded-lg font-medium text-sm transition-all"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#C8B89A',
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Role Badge */}
            <div className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: '#888' }}
              >
                Role
              </label>
              <div className="inline-block">
                <span
                  className="px-4 py-2 rounded-full text-sm font-medium inline-block"
                  style={{
                    backgroundColor:
                      profile.role === 'admin'
                        ? 'rgba(200,184,154,0.15)'
                        : 'rgba(100,200,154,0.15)',
                    color: profile.role === 'admin' ? '#C8B89A' : '#64C89A',
                    textTransform: 'capitalize',
                  }}
                >
                  {profile.role}
                </span>
              </div>
            </div>

            {/* Brand Assignment */}
            {brandName && (
              <div className="space-y-2">
                <label
                  className="text-xs font-medium uppercase tracking-wider"
                  style={{ color: '#888' }}
                >
                  Assigned Brand
                </label>
                <div
                  className="px-4 py-3 rounded-lg"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <p style={{ color: '#F5F5F8' }}>{brandName}</p>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Update Password */}
          <div
            className="rounded-xl p-6 space-y-6"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div>
              <h2 className="text-lg font-semibold" style={{ color: '#F5F5F8' }}>
                Update Password
              </h2>
              <p className="text-xs mt-1" style={{ color: '#888' }}>
                Change your password to keep your account secure
              </p>
            </div>

            {/* Current Password */}
            <div className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: '#888' }}
              >
                Current Password
              </label>
              <div
                className="relative"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '0.75rem',
                }}
              >
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 rounded-lg text-sm outline-none transition-all"
                  style={{
                    backgroundColor: 'transparent',
                    color: '#F5F5F8',
                  }}
                  placeholder="Enter your current password"
                  disabled={isUpdatingPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#888' }}
                >
                  {showCurrentPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: '#888' }}
              >
                New Password
              </label>
              <div
                className="relative"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '0.75rem',
                }}
              >
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 rounded-lg text-sm outline-none transition-all"
                  style={{
                    backgroundColor: 'transparent',
                    color: '#F5F5F8',
                  }}
                  placeholder="Enter your new password"
                  disabled={isUpdatingPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#888' }}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs" style={{ color: '#666' }}>
                Must be at least 8 characters long
              </p>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <label
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: '#888' }}
              >
                Confirm New Password
              </label>
              <div
                className="relative"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '0.75rem',
                }}
              >
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 rounded-lg text-sm outline-none transition-all"
                  style={{
                    backgroundColor: 'transparent',
                    color: '#F5F5F8',
                  }}
                  placeholder="Confirm your new password"
                  disabled={isUpdatingPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#888' }}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* Update Button */}
            <button
              onClick={handleUpdatePassword}
              disabled={isUpdatingPassword}
              className="w-full px-6 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #C8B89A 0%, #A89474 100%)',
                color: '#0A0A0A',
              }}
            >
              {isUpdatingPassword ? 'Updating Password...' : 'Update Password'}
            </button>
          </div>
        </div>

        {/* Toast Notifications */}
        <div className="fixed bottom-6 right-6 space-y-2 z-50 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4"
              style={{
                backgroundColor:
                  toast.type === 'success'
                    ? 'rgba(100,200,154,0.15)'
                    : 'rgba(239,68,68,0.15)',
                border:
                  toast.type === 'success'
                    ? '1px solid rgba(100,200,154,0.3)'
                    : '1px solid rgba(239,68,68,0.3)',
                color: toast.type === 'success' ? '#64C89A' : '#EF4444',
              }}
            >
              {toast.type === 'success' ? (
                <CheckCircle size={18} className="flex-shrink-0" />
              ) : (
                <AlertCircle size={18} className="flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{toast.message}</span>
            </div>
          ))}
        </div>
      </div>
    </Navbar>
  );
}

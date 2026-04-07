"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);

    try {
      // Sign in with Supabase
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (authError) {
        setError(authError.message || "Failed to sign in");
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setError("No user data returned");
        setLoading(false);
        return;
      }

      // Fetch user profile to get role
      const { data: profileData, error: profileError } = await supabase
        .from("users_profile")
        .select("role")
        .eq("id", authData.user.id)
        .single();

      if (profileError) {
        setError("Failed to fetch user profile");
        setLoading(false);
        return;
      }

      const userRole = profileData?.role || "strategist";

      setSuccess(true);

      // Redirect based on role
      setTimeout(() => {
        if (userRole === "admin") {
          router.push("/admin");
        } else if (userRole === "founder") {
          router.push("/dashboard");
        } else {
          router.push("/upload");
        }
      }, 1000);
    } catch (err) {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{
        backgroundColor: "#0a0a0a",
        backgroundImage:
          "radial-gradient(circle at 20% 50%, rgba(200,184,154,0.05) 0%, transparent 50%)",
      }}
    >
      {/* Glass Card Container */}
      <div
        className="w-full max-w-md mx-4 p-10 rounded-xl backdrop-blur border"
        style={{
          backgroundColor: "rgba(13,13,13,0.5)",
          borderColor: "rgba(255,255,255,0.1)",
        }}
      >
        {/* Wordmark */}
        <div className="mb-6 text-center">
          <h1 className="text-4xl font-bold mb-2">
            <span style={{ color: "#F5F5F8" }}>melch</span>
            <span style={{ color: "#C8B89A" }}>.cloud</span>
          </h1>
          <p className="text-xs" style={{ color: "#ABABAB" }}>
            Creative Upload Portal
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div
            className="mb-6 p-4 rounded-xl flex items-start gap-3 border"
            style={{
              backgroundColor: "rgba(239,68,68,0.1)",
              borderColor: "rgba(239,68,68,0.3)",
            }}
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#EF4444" }} />
            <p className="text-sm" style={{ color: "#EF4444" }}>
              {error}
            </p>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div
            className="mb-6 p-4 rounded-xl flex items-start gap-3 border"
            style={{
              backgroundColor: "rgba(34,197,94,0.1)",
              borderColor: "rgba(34,197,94,0.3)",
            }}
          >
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#22C55E" }} />
            <p className="text-sm" style={{ color: "#22C55E" }}>
              Login successful! Redirecting...
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Input */}
          <div>
            <label className="block text-sm mb-2" style={{ color: "#ABABAB" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={loading}
              required
              className="w-full px-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2"
              style={{
                backgroundColor: "#222",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#F5F5F8",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#C8B89A";
                e.currentTarget.style.boxShadow = "0 0 0 2px rgba(200,184,154,0.2)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Password Input */}
          <div>
            <label className="block text-sm mb-2" style={{ color: "#ABABAB" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              required
              className="w-full px-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2"
              style={{
                backgroundColor: "#222",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#F5F5F8",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#C8B89A";
                e.currentTarget.style.boxShadow = "0 0 0 2px rgba(200,184,154,0.2)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold transition-opacity disabled:opacity-50"
            style={{
              backgroundColor: "#C8B89A",
              color: "#0A0A0A",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {/* Footer */}
        <p className="text-xs mt-8 text-center" style={{ color: "#ABABAB" }}>
          Contact support for demo credentials
        </p>
      </div>
    </div>
  );
}

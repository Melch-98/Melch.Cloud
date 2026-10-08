import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        satoshi: ["Satoshi", "Inter", "sans-serif"],
        inter: ["Inter", "sans-serif"],
        display: ["Satoshi", "Inter", "sans-serif"],
      },
      boxShadow: {
        popover: "0 12px 40px rgba(0,0,0,0.45)",
        modal: "0 24px 80px rgba(0,0,0,0.55)",
        control: "0 1px 2px rgba(0,0,0,0.4)",
        container: "0 1px 2px rgba(0,0,0,0.35)",
      },
      colors: {
        // Funnel Viewer chrome. The constellation palette stays in the
        // ported theme module; these tokens only restyle the viewer's
        // Tailwind class names onto Melch's dark surfaces.
        text: {
          primary: "#f5f5f8",
          secondary: "#c4c4c8",
          muted: "#888888",
        },
        surface: {
          DEFAULT: "#0a0a0a",
          raised: "#111111",
          overlay: "#161616",
          recessed: "#0d0d0d",
          control: "#1a1a1a",
        },
        hover: "rgba(255,255,255,0.06)",
        line: {
          DEFAULT: "rgba(255,255,255,0.08)",
          strong: "rgba(255,255,255,0.14)",
          hover: "rgba(255,255,255,0.2)",
        },
        select: {
          DEFAULT: "rgba(200,184,154,0.16)",
          line: "rgba(200,184,154,0.45)",
        },
        rust: {
          500: "#d4c4a8",
          600: "#c8b89a",
          700: "#b5a588",
        },
        "on-accent": "#0a0a0a",
        "accent-ink": "#c8b89a",
        "on-media": "#f5f5f8",
        "media-scrim": "rgba(0,0,0,0.55)",
        success: { DEFAULT: "#22c55e", solid: "#22c55e" },
        warning: { DEFAULT: "#f59e0b", solid: "#f59e0b" },
        error: { DEFAULT: "#ef4444", solid: "#ef4444" },
        brand: {
          bg: "#0a0a0a",
          "bg-secondary": "#0d0d0d",
          "bg-card": "rgba(13, 13, 13, 0.5)",
          gold: "#c8b89a",
          "text-primary": "#f5f5f8",
          "text-secondary": "#ababab",
          "border-white": "rgba(255, 255, 255, 0.1)",
          "overlay-dark": "rgba(34, 34, 34, 0.8)",
          surface: "#222222",
        },
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-gold": {
          "0%, 100%": { boxShadow: "0 0 0 0 #c8b89a" },
          "50%": { boxShadow: "0 0 0 10px rgba(200, 184, 154, 0)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.3s ease-in-out",
        "slide-down": "slideDown 0.3s ease-in-out",
        "pulse-gold": "pulse-gold 2s infinite",
      },
    },
  },
  plugins: [],
};
export default config;

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
      },
      colors: {
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        atv: {
          black:    "#000000",
          bg:       "#0d0d0d",
          surface:  "#1c1c1e",
          elevated: "#2c2c2e",
          border:   "rgba(255,255,255,0.12)",
          hover:    "rgba(255,255,255,0.08)",
          text:     "#ffffff",
          secondary:"rgba(255,255,255,0.60)",
          muted:    "rgba(255,255,255,0.30)",
          selected: "rgba(255,255,255,0.15)",
        },
      },
      fontFamily: { sans: ["Inter","system-ui","sans-serif"] },
      backdropBlur: { atv: "20px", heavy: "40px" },
      borderRadius: { pill: "999px", card: "10px", lg2: "16px" },
      boxShadow: {
        glass:  "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
        card:   "0 4px 20px rgba(0,0,0,0.6)",
        "card-hover": "0 8px 36px rgba(0,0,0,0.8)",
        glow:   "0 0 0 2px rgba(255,255,255,0.35)",
      },
      keyframes: {
        shimmer:{"0%":{backgroundPosition:"-200% 0"},"100%":{backgroundPosition:"200% 0"}},
        fadeUp: {"0%":{opacity:"0",transform:"translateY(10px)"},"100%":{opacity:"1",transform:"translateY(0)"}},
        fadeIn: {"0%":{opacity:"0"},"100%":{opacity:"1"}},
        scaleIn:{"0%":{opacity:"0",transform:"scale(0.96)"},"100%":{opacity:"1",transform:"scale(1)"}},
        slideLeft:{"0%":{transform:"translateX(0)"},"100%":{transform:"translateX(-100%)"}},
      },
      animation: {
        shimmer:  "shimmer 1.8s infinite linear",
        fadeUp:   "fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) forwards",
        fadeIn:   "fadeIn 0.3s ease forwards",
        scaleIn:  "scaleIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.16,1,0.3,1)",
        spring: "cubic-bezier(0.34,1.56,0.64,1)",
      },
    },
  },
  plugins: [],
}
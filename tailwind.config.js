/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  corePlugins: {
    animation: false,
    transitionProperty: false,
    transitionDuration: false,
    transitionTimingFunction: false,
    transitionDelay: false,
  },
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
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"] },
      backdropBlur: { atv: "20px", heavy: "40px" },
      borderRadius: { pill: "999px", card: "10px", lg2: "16px" },
      boxShadow: {
        glass:  "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
        card:   "0 4px 20px rgba(0,0,0,0.6)",
        "card-hover": "0 8px 36px rgba(0,0,0,0.8)",
        glow:   "0 0 0 2px rgba(255,255,255,0.35)",
      },
    },
  },
  plugins: [],
}

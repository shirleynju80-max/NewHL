/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        fin: {
          navy: "var(--fin-navy)",
          surface: "var(--fin-surface)",
          panel: "var(--fin-panel)",
          border: "var(--fin-border)",
          text: "var(--fin-text)",
          muted: "var(--fin-muted)",
          blue: "var(--fin-blue)",
          teal: "var(--fin-teal)",
          up: "var(--fin-up)",
          down: "var(--fin-down)",
        },
      },
      borderRadius: {
        fin: "3px",
      },
      letterSpacing: {
        "fin-kicker": "0.14em",
      },
      boxShadow: {
        fin: "0 1px 0 rgba(12, 18, 32, 0.04), 0 8px 24px -12px rgba(7, 13, 24, 0.08)",
      },
    },
  },
  plugins: [],
};

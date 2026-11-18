export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.js"],
  theme: {
    extend: {
      colors: {
        "page": "rgb(var(--c-page) / <alpha-value>)",
        "surface": "rgb(var(--c-surface) / <alpha-value>)",
        "head": "rgb(var(--c-head) / <alpha-value>)",
        "field": "rgb(var(--c-field) / <alpha-value>)",
        "subtle": "rgb(var(--c-subtle) / <alpha-value>)",
        "tab": "rgb(var(--c-tab) / <alpha-value>)",
        "tint": "rgb(var(--c-tint) / <alpha-value>)",
        "tint-2": "rgb(var(--c-tint-2) / <alpha-value>)",
        "sel": "rgb(var(--c-sel) / <alpha-value>)",
        "sel-2": "rgb(var(--c-sel-2) / <alpha-value>)",
        "accent-soft": "rgb(var(--c-accent-soft) / <alpha-value>)",
        "accent-soft-2": "rgb(var(--c-accent-soft-2) / <alpha-value>)",
        "primary": "rgb(var(--c-primary) / <alpha-value>)",
        "primary-dark": "rgb(var(--c-primary-dark) / <alpha-value>)",
        "primary-light": "rgb(var(--c-primary-light) / <alpha-value>)",
        "danger": "rgb(var(--c-danger) / <alpha-value>)",
        "danger-soft": "rgb(var(--c-danger-soft) / <alpha-value>)",
        "ok-soft": "rgb(var(--c-ok-soft) / <alpha-value>)",
        "fg": "rgb(var(--c-fg) / <alpha-value>)",
        "fg-2": "rgb(var(--c-fg-2) / <alpha-value>)",
        "soft": "rgb(var(--c-soft) / <alpha-value>)",
        "faint": "rgb(var(--c-faint) / <alpha-value>)",
        "faint-2": "rgb(var(--c-faint-2) / <alpha-value>)",
        "deep": "rgb(var(--c-deep) / <alpha-value>)",
        "deep-2": "rgb(var(--c-deep-2) / <alpha-value>)",
        "forest": "rgb(var(--c-forest) / <alpha-value>)",
        "on-primary": "rgb(var(--c-on-primary) / <alpha-value>)",
        "bd": "rgb(var(--c-bd) / <alpha-value>)",
        "bd-2": "rgb(var(--c-bd-2) / <alpha-value>)",
        "bd-3": "rgb(var(--c-bd-3) / <alpha-value>)",
        "bd-in": "rgb(var(--c-bd-in) / <alpha-value>)",
        "bd-acc": "rgb(var(--c-bd-acc) / <alpha-value>)",
        "bd-ok": "rgb(var(--c-bd-ok) / <alpha-value>)",
        "bd-danger": "rgb(var(--c-bd-danger) / <alpha-value>)",
        "overlay": "rgb(var(--c-overlay) / <alpha-value>)"
      },
      keyframes: {
        attention: {
          "0%": { boxShadow: "0 0 0 0 rgb(49 94 85 / 0.45)" },
          "70%, 100%": { boxShadow: "0 0 0 10px rgb(49 94 85 / 0)" }
        }
      },
      animation: {
        attention: "attention 1.8s ease-out infinite"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

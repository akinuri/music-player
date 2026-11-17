export default {
  content: ["./index.html", "./src/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#202c28",
        muted: "#75817a",
        canvas: "#f6f7f3",
        line: "#e7ebe4",
        forest: "#254f3d"
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

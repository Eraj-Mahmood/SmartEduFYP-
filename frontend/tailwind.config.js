/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101826",        // near-black navy background for chrome
        slate: {
          850: "#182233",
        },
        brand: {
          DEFAULT: "#2F5D8A",  // primary academic blue
          light: "#4C7BAA",
          dark: "#1F3E5C",
        },
        accent: "#E0A94C",      // warm amber accent (attention / at-risk)
        safe: "#3E8E5B",
        risk: "#D48A2A",
        danger: "#C24B4B",
        paper: "#F6F4EF",
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
import trac from "tailwindcss-react-aria-components";
import contQueries from "@tailwindcss/container-queries";

export default {
  darkMode: "class",
  content: ["./index.html", "./download.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontSize: {
        "2xs": "0.65rem",
        "keycap-xs": "0.45rem",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        keycap: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        recess: "var(--recess)",
        "surface-elevated": "var(--surface-elevated)",
        border: "var(--border)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        primary: "var(--accent)",
        "primary-content": "var(--accent-foreground)",
        "base-content": "var(--foreground)",
        "base-100": "var(--surface)",
        "base-200": "var(--background)",
        "base-300": "var(--recess)",
      },
    },
  },
  plugins: [contQueries, trac({ prefix: "rac" })],
};

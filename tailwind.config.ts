import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        auction: {
          black: "#050505",
          ink: "#0b0b0c",
          panel: "#111112",
          charcoal: "#19191b",
          line: "#2b2721",
          gold: "#c69b52",
          goldSoft: "#e1bd78",
          ivory: "#f4efe5",
          muted: "#a8a29a",
          danger: "#ff463f",
          ember: "#ff8b3d",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(198, 155, 82, 0.16), 0 18px 60px rgba(0, 0, 0, 0.45)",
      },
      backgroundImage: {
        "soft-noise":
          "linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0)), linear-gradient(180deg, #0a0a0b, #050505)",
      },
    },
  },
  plugins: [],
};

export default config;

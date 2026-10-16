// Design tokens: the single source for colours. tailwind.config.js imports this file so
// Tailwind classes and recharts (which needs raw hex values) always agree.

export const colors = {
  ink: "#101826", // near-black navy: text and app chrome
  paper: "#F6F4EF", // warm page background
  surface: "#FFFFFF",
  line: "#E6E1D7", // hairlines and card borders
  muted: "#5B6474", // secondary text (AA on paper and white)
  brand: { DEFAULT: "#2F5D8A", light: "#4C7BAA", dark: "#1F3E5C", 50: "#EEF3F8", 100: "#D6E2EE" },
  safe: { DEFAULT: "#3E8E5B", 50: "#ECF6EF", 100: "#D3EBDB", 500: "#3E8E5B", 700: "#2C6A43" },
  risk: { DEFAULT: "#D48A2A", 50: "#FDF5E8", 100: "#F8E4C2", 500: "#D48A2A", 700: "#8F5710" },
  danger: { DEFAULT: "#C24B4B", 50: "#FBEDED", 100: "#F3D2D2", 500: "#C24B4B", 700: "#943434" },
  accent: "#E0A94C",
};

// Series colours for charts (marks components, neutral comparisons)
export const chart = {
  grid: "#ECE8DF",
  axis: "#8A92A0",
  series: ["#2F5D8A", "#3C8D93", "#C9A86A", "#7A8597"],
  neutral: "#9AA3B2",
  reference: "#5B6474",
};

export const riskColor = {
  Safe: colors.safe.DEFAULT,
  "At-Risk": colors.risk.DEFAULT,
  "Dropout-Likely": colors.danger.DEFAULT,
};

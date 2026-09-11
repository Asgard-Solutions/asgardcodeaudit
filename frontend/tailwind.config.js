/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['Chivo', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        base: {
          900: '#0b0d10',
          850: '#101318',
          800: '#151a21',
          700: '#1c232c',
          600: '#273140',
        },
        ink: {
          DEFAULT: '#e6ebf2',
          muted: '#8a97a8',
          faint: '#5b6675',
        },
        signal: {
          DEFAULT: '#f0b429',
          soft: '#f7c948',
        },
        verified: '#3fbf9f',
        gap: '#e8674f',
        unknown: '#7c8aa0',
        line: '#232c37',
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 40px -12px rgba(0,0,0,0.7)',
      },
    },
  },
  plugins: [],
};

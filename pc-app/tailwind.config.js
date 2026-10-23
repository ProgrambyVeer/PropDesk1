/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'sans-serif'], mono: ['"JetBrains Mono"', 'monospace'] },
      colors: { navy: { DEFAULT: '#0F172A', 900: '#0A1226', 800: '#1E293B' }, brand: { DEFAULT: '#18181B', 600: '#18181B', 50: '#F4F4F5', 100: '#E4E4E7' } },
      boxShadow: { card: '0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06)', lift: '0 10px 30px rgba(15,23,42,.10)' },
      keyframes: { up: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } }, sheet: { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } } },
      animation: { up: 'up .35s ease-out both', sheet: 'sheet .28s cubic-bezier(.2,.8,.2,1) both' },
    },
  },
  plugins: [],
};

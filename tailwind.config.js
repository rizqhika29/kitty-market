/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        night: {
          950: '#0a0614',
          900: '#100a1f',
          800: '#181030',
          700: '#241845',
        },
        brand: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
        },
        punch: {
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',
          600: '#c026d3',
        },
      },
      keyframes: {
        auroraDrift: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(40px, -25px) scale(1.08)' },
          '66%': { transform: 'translate(-30px, 20px) scale(0.95)' },
        },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(28px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmerSweep: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
        tickerScroll: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        aurora: 'auroraDrift 14s ease-in-out infinite',
        rise: 'riseIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        shimmer: 'shimmerSweep 1.6s ease infinite',
        ticker: 'tickerScroll 32s linear infinite',
      },
    },
  },
  plugins: [],
}

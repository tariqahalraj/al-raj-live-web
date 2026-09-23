import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    screens: {
      sm: '640px',
      md: { raw: '(min-width: 768px) and (min-height: 560px)' },
      lg: { raw: '(min-width: 1024px) and (min-height: 560px)' },
      xl: { raw: '(min-width: 1280px) and (min-height: 560px)' },
      '2xl': { raw: '(min-width: 1536px) and (min-height: 560px)' },
    },
    extend: {
      colors: {
        raj: {
          navy: '#0F172A',
          blue: '#0A4C95',
          'blue-hover': '#083B75',
          green: '#059669',
          'green-dark': '#047857',
          'green-hover': '#046C4E',
          'green-light': '#DCFCE7',
          'green-ring': '#BBF7D0',
          online: '#10B981',
          red: '#DC2626',
          'red-light': '#FEE2E2',
          'red-hover': '#B91C1C',
          slate: '#64748B',
          border: '#E2E8F0',
          bg: '#FFFFFF',
          card: '#F8FAFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Bengali', 'Hind Siliguri', 'Kalpurush', 'system-ui', '-apple-system', 'sans-serif'],
        bengali: ['Noto Sans Bengali', 'Hind Siliguri', 'Kalpurush', 'sans-serif'],
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.95)', opacity: '0.8' },
          '50%': { transform: 'scale(1.08)', opacity: '0.4' },
          '100%': { transform: 'scale(0.95)', opacity: '0.8' },
        },
        'ripple': {
          '0%': { transform: 'scale(0.9)', opacity: '1' },
          '100%': { transform: 'scale(1.3)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ripple': 'ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;

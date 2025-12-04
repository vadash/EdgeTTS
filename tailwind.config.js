/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{tsx,ts}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1a1a1a',
          secondary: '#252525',
          tertiary: '#333',
        },
        accent: {
          DEFAULT: '#0d6efd',
          hover: '#0b5ed7',
          glow: 'rgba(13, 110, 253, 0.3)',
        },
        border: '#404040',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
};

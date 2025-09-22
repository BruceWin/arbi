/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          DEFAULT: '#0f172a',
          subtle: '#1e293b'
        }
      }
    }
  },
  plugins: []
};

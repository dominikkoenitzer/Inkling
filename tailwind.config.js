/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/quickadd.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg-app)',
        panel: 'var(--bg-panel)',
        sunken: 'var(--bg-sunken)',
        raised: 'var(--bg-raised)',
        hover: 'var(--bg-hover)',
        active: 'var(--bg-active)',
        ink: 'var(--text-primary)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        edge: 'var(--border)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-text': 'var(--accent-text)'
      },
      fontSize: {
        base: ['var(--font-base)', '1.55']
      },
      borderRadius: {
        card: '10px'
      }
    }
  },
  plugins: []
}

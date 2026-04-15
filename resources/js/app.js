import Alpine from 'alpinejs'
window.Alpine = Alpine

/* ---------------------------------------------------------------
   Alert component
   --------------------------------------------------------------- */
Alpine.data('alert', function () {
  return {
    isVisible: false,
    dismiss() {
      this.isVisible = false
    },
    init() {
      setTimeout(() => {
        this.isVisible = true
      }, 80)
      setTimeout(() => {
        this.dismiss()
      }, 5000)
    },
  }
})

/* ---------------------------------------------------------------
   Theme & accent color manager
   Loads initial state from server-rendered user prefs,
   saves changes to the database via POST /cms/profile/appearance.
   --------------------------------------------------------------- */
const ACCENT_PRESETS = [
  { name: 'Blue', hue: 240, chroma: 0.18, swatch: 'oklch(0.55 0.2 240)' },
  { name: 'Violet', hue: 280, chroma: 0.19, swatch: 'oklch(0.55 0.2 280)' },
  { name: 'Rose', hue: 350, chroma: 0.19, swatch: 'oklch(0.55 0.2 350)' },
  { name: 'Emerald', hue: 155, chroma: 0.17, swatch: 'oklch(0.55 0.18 155)' },
  { name: 'Amber', hue: 75, chroma: 0.16, swatch: 'oklch(0.6 0.18 75)' },
  { name: 'Teal', hue: 185, chroma: 0.14, swatch: 'oklch(0.55 0.15 185)' },
  { name: 'Orange', hue: 30, chroma: 0.18, swatch: 'oklch(0.6 0.2 30)' },
]

window.__ACCENT_PRESETS = ACCENT_PRESETS

Alpine.data('themeManager', function () {
  return {
    theme: 'system',   // 'light' | 'dark' | 'system'
    accentIndex: 0,
    presets: ACCENT_PRESETS,
    showAppearance: false,
    saving: false,

    get isDark() {
      if (this.theme === 'dark') return true
      if (this.theme === 'light') return false
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    },

    init() {
      // Read server-rendered user prefs from data attributes
      const el = this.$el
      this.theme = el.dataset.theme || 'system'
      this.accentIndex = parseInt(el.dataset.accent || '0', 10)

      this.applyTheme()
      this.applyAccent()

      // Listen for system changes when theme is 'system'
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'system') this.applyTheme()
      })
    },

    setTheme(value) {
      this.theme = value
      this.applyTheme()
      this.persist()
    },

    setAccent(index) {
      this.accentIndex = index
      this.applyAccent()
      this.persist()
    },

    applyTheme() {
      document.documentElement.classList.toggle('dark', this.isDark)
    },

    applyAccent() {
      const preset = ACCENT_PRESETS[this.accentIndex] || ACCENT_PRESETS[0]
      document.documentElement.style.setProperty('--accent-hue', preset.hue)
      document.documentElement.style.setProperty('--accent-chroma', preset.chroma)
    },

    async persist() {
      this.saving = true
      const csrfMeta = document.querySelector('meta[name="csrf-token"]')
      const headers = { 'Content-Type': 'application/json' }
      if (csrfMeta) headers['x-csrf-token'] = csrfMeta.content

      try {
        await fetch('/cms/profile/appearance', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            theme: this.theme,
            accentColor: this.accentIndex,
          }),
        })
      } catch (e) {
        // Silently fail – preference still applied client-side
      } finally {
        this.saving = false
      }
    },
  }
})

/* ---------------------------------------------------------------
   Apply theme/accent ASAP to prevent flicker (before Alpine boots).
   Reads from a <script id="user-prefs"> injected by the layout.
   --------------------------------------------------------------- */
;(function () {
  const prefsEl = document.getElementById('user-prefs')
  if (prefsEl) {
    try {
      const prefs = JSON.parse(prefsEl.textContent)
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const isDark =
        prefs.theme === 'dark' || (prefs.theme === 'system' && prefersDark)
      if (isDark) document.documentElement.classList.add('dark')

      const preset = (window.__ACCENT_PRESETS || ACCENT_PRESETS)[prefs.accentColor] || ACCENT_PRESETS[0]
      document.documentElement.style.setProperty('--accent-hue', preset.hue)
      document.documentElement.style.setProperty('--accent-chroma', preset.chroma)
    } catch (e) {}
  }
})()

Alpine.start()

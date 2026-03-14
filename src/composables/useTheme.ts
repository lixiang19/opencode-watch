import { computed, onUnmounted, ref, watch } from 'vue'

import { STORAGE_KEYS } from './useOpencodeApp/constants'

export type ThemePreference = 'system' | 'light' | 'dark'

const VALID: ThemePreference[] = ['system', 'light', 'dark']

function readStored(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.theme)
    if (raw && VALID.includes(raw as ThemePreference)) {
      return raw as ThemePreference
    }
  } catch { /* ignore */ }
  return 'system'
}

const preference = ref<ThemePreference>(readStored())

export function useTheme() {
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (e: MediaQueryListEvent) => { systemDark.value = e.matches }
  mq.addEventListener('change', onChange)
  onUnmounted(() => mq.removeEventListener('change', onChange))

  const isDark = computed(() => {
    if (preference.value === 'dark') return true
    if (preference.value === 'light') return false
    return systemDark.value
  })

  watch(preference, (v) => {
    try { localStorage.setItem(STORAGE_KEYS.theme, v) } catch { /* ignore */ }
  })

  watch(isDark, (dark) => {
    document.documentElement.classList.toggle('dark', dark)
  }, { immediate: true })

  function setTheme(value: ThemePreference) {
    preference.value = value
  }

  return { preference, isDark, setTheme }
}

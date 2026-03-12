export interface InstallPromptChoice {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<InstallPromptChoice>
}

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export function getNotificationPermission() {
  return isNotificationSupported() ? Notification.permission : 'default'
}

export function isStandaloneDisplay() {
  if (typeof window === 'undefined') {
    return false
  }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function trimNotificationBody(input: string, maxLength = 72) {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return ''
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}...`
}

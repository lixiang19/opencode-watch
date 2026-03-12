export function readStorage(key: string, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback
  }

  const value = window.localStorage.getItem(key)
  return value ?? fallback
}

export function writeStorage(key: string, value: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, value)
}

export function readSessionStorage(key: string, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback
  }

  const value = window.sessionStorage.getItem(key)
  return value ?? fallback
}

export function writeSessionStorage(key: string, value: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(key, value)
}

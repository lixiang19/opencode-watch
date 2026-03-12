export function formatRelativeTime(timestamp?: number) {
  if (!timestamp) {
    return '刚刚'
  }

  const diff = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) {
    return '刚刚'
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`
  }

  if (hours < 24) {
    return `${hours} 小时前`
  }

  return `${days} 天前`
}

export function formatClockTime(timestamp?: number) {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

<script setup lang="ts">
import { computed } from 'vue'
import {
  BellRing,
  CircleAlert,
  Download,
  FolderOpen,
  Info,
  Link2,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  User
} from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import { useTheme, type ThemePreference } from '@/composables/useTheme'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()
const { preference: themePreference, setTheme } = useTheme()

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon }
]

const connectionTone = computed(() => {
  if (app.streamReady) {
    return 'status-ok'
  }

  return app.hasOpenCodeConfig ? 'status-error' : 'status-muted'
})
const connectionCopy = computed(() => {
  if (app.isConnecting) {
    return '正在验证 OpenCode 健康状态并建立实时订阅。'
  }

  if (app.streamReady) {
    return '当前 OpenCode 已连接，新的消息与全局事件会直接从这个地址订阅。'
  }

  if (!app.hasOpenCodeConfig) {
    return '请先填写 OpenCode 地址、账号和密码，保存后即可开始连接。'
  }

  return app.lastError || 'OpenCode 尚未连接，请检查地址、认证信息或服务端 CORS。'
})
const serverEndpoint = computed(() => {
  try {
    if (!app.serverUrl.trim()) {
      throw new Error('empty')
    }

    const url = new URL(app.serverUrl)
    return {
      href: url.toString(),
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
      path: url.pathname || '/'
    }
  } catch {
    return {
      href: app.serverUrl || '--',
      host: '--',
      port: '--',
      path: '--'
    }
  }
})
const notificationTone = computed(() => {
  if (!app.notificationSupported) {
    return 'status-muted'
  }

  if (app.notificationsEnabled) {
    return 'status-ok'
  }

  return app.notificationPermission === 'denied' ? 'status-error' : 'status-warn'
})
const notificationStatusText = computed(() => {
  if (!app.notificationSupported) {
    return '当前浏览器不支持通知'
  }

  if (app.notificationsEnabled) {
    return '已允许后台完成通知'
  }

  if (app.notificationPermission === 'denied') {
    return '通知权限已被拒绝'
  }

  return '尚未开启通知权限'
})
const notificationHintText = computed(() => {
  if (!app.notificationSupported) {
    return '请改用支持 Service Worker 和 Notification API 的浏览器。'
  }

  if (app.notificationsEnabled) {
    return 'AI 完成后，只要页面仍在后台运行，就会弹出系统通知。'
  }

  if (app.notificationPermission === 'denied') {
    return '请在浏览器站点设置里重新允许通知。'
  }

  return '建议先允许通知，再把应用安装到桌面或主屏。'
})
const installStatusText = computed(() => {
  if (app.isPwaInstalled) {
    return '已安装到设备'
  }

  if (app.installAvailable) {
    return '可直接安装'
  }

  return '可用浏览器菜单安装'
})
</script>

<template>
  <div class="settings-container">
    <header class="settings-header">
      <div class="header-title">
        <h1>设置</h1>
        <p class="header-subtitle">管理唯一的 OpenCode 连接配置与应用偏好</p>
      </div>
    </header>

    <main class="settings-content">
      <div class="settings-stack">
        <Card class="status-card" :class="connectionTone">
          <div class="card-body">
            <div class="status-icon-box">
              <ShieldCheck v-if="app.streamReady" class="h-6 w-6" />
              <CircleAlert v-else class="h-6 w-6" />
            </div>
            <div class="status-info">
              <h3>{{ app.connectionStateLabel }}</h3>
              <p>{{ connectionCopy }}</p>
            </div>
          </div>
        </Card>

        <Card class="form-card">
          <div class="form-section">
            <div class="section-header">
              <Link2 class="h-4 w-4" />
              <span>OpenCode</span>
            </div>

            <div class="form-group">
              <label>OpenCode 地址</label>
              <Input v-model="app.serverUrl" placeholder="https://opencode.example.com" autocomplete="url" />
            </div>

            <div class="endpoint-grid">
              <div class="endpoint-tile">
                <span class="endpoint-label">当前地址</span>
                <strong>{{ serverEndpoint.href }}</strong>
              </div>
              <div class="endpoint-tile">
                <span class="endpoint-label">主机</span>
                <strong>{{ serverEndpoint.host }}</strong>
              </div>
              <div class="endpoint-tile">
                <span class="endpoint-label">路径</span>
                <strong>{{ serverEndpoint.path }}</strong>
              </div>
              <div class="endpoint-tile">
                <span class="endpoint-label">端口</span>
                <strong>{{ serverEndpoint.port }}</strong>
              </div>
            </div>

            <div class="form-hint">
              <Info class="h-3 w-3" />
              <span>聊天、会话列表和 SSE 实时事件都会直接连接这个 OpenCode 地址，不再经过本项目后端转发。</span>
            </div>
          </div>

          <div class="section-divider"></div>

          <div class="form-section">
            <div class="section-header">
              <User class="h-4 w-4" />
              <span>认证</span>
            </div>

            <div class="form-group">
              <label>账号</label>
              <Input v-model="app.username" placeholder="请输入账号" autocomplete="username" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <Input v-model="app.password" type="password" placeholder="请输入密码" autocomplete="current-password" />
            </div>

            <div class="form-hint">
              <Info class="h-3 w-3" />
              <span>这里是 OpenCode 的 Basic Auth；地址、账号和密码都会直接保存在当前浏览器本地。</span>
            </div>
          </div>

          <div class="section-divider"></div>

          <div class="form-section">
            <div class="section-header">
              <FolderOpen class="h-4 w-4" />
              <span>默认路径</span>
            </div>

            <div class="form-group">
              <label>新建对话保存目录</label>
              <Input v-model="app.draftDirectory" placeholder="/Users/name/projects" />
            </div>
          </div>

          <div class="card-footer">
            <div class="action-grid">
              <Button class="action-btn" :disabled="app.isConnecting" @click="app.connect">
                <Link2 v-if="!app.isConnecting" class="h-4 w-4 mr-2" />
                <RefreshCw v-else class="h-4 w-4 mr-2 animate-spin" />
                {{ app.isConnecting ? '连接中' : '测试并连接' }}
              </Button>
              <Button variant="outline" class="action-btn" :disabled="app.isRefreshing || !app.authValidated" @click="app.refreshSessions({ reopen: false, refreshProjects: true })">
                <RefreshCw class="h-4 w-4 mr-2" :class="app.isRefreshing ? 'animate-spin' : ''" />
                同步数据
              </Button>
              <Button variant="outline" class="action-btn" :disabled="!app.adminAuthenticated" @click="app.logoutAdmin">
                <CircleAlert class="h-4 w-4 mr-2" />
                退出管理登录
              </Button>
            </div>
          </div>
        </Card>

        <Card class="form-card">
          <div class="form-section">
            <div class="section-header">
              <Sun class="h-4 w-4" />
              <span>外观</span>
            </div>
            <div class="theme-switcher">
              <button
                v-for="opt in themeOptions"
                :key="opt.value"
                type="button"
                class="theme-option"
                :class="{ 'theme-option-active': themePreference === opt.value }"
                @click="setTheme(opt.value)"
              >
                <component :is="opt.icon" class="h-4 w-4" />
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>
        </Card>

        <Card class="form-card">
          <div class="form-section">
            <div class="section-header">
              <Smartphone class="h-4 w-4" />
              <span>PWA 与通知</span>
            </div>

            <div class="status-tile" :class="notificationTone">
              <div class="status-tile-icon">
                <BellRing class="h-5 w-5" />
              </div>
              <div class="status-tile-copy">
                <strong>{{ notificationStatusText }}</strong>
                <p>{{ notificationHintText }}</p>
              </div>
            </div>

            <div class="status-tile" :class="app.isPwaInstalled ? 'status-ok' : 'status-muted'">
              <div class="status-tile-icon">
                <Download class="h-5 w-5" />
              </div>
              <div class="status-tile-copy">
                <strong>{{ installStatusText }}</strong>
                <p>安装后更像原生应用，但通知仍依赖页面在后台保持运行。</p>
              </div>
            </div>

            <div class="action-grid">
              <Button
                class="action-btn"
                :disabled="!app.notificationSupported || app.notificationsEnabled || app.isRequestingNotificationPermission"
                @click="app.requestNotificationPermission"
              >
                <BellRing class="h-4 w-4 mr-2" />
                {{ app.notificationsEnabled ? '通知已开启' : app.isRequestingNotificationPermission ? '请求中' : '开启完成通知' }}
              </Button>
              <Button
                variant="outline"
                class="action-btn"
                :disabled="app.isPwaInstalled || !app.installAvailable"
                @click="app.promptInstall"
              >
                <Download class="h-4 w-4 mr-2" />
                {{ app.isPwaInstalled ? '已安装' : app.installAvailable ? '安装应用' : '请用浏览器菜单安装' }}
              </Button>
            </div>

            <div class="form-hint">
              <Info class="h-3 w-3" />
              <span>关闭页面或系统彻底杀掉应用后，前端通知不会继续工作。</span>
            </div>
          </div>
        </Card>

        <transition name="fade">
          <div v-if="app.lastError" class="error-log">
            <div class="error-header">
              <CircleAlert class="h-4 w-4" />
              <span>最近一次错误</span>
            </div>
            <p>{{ app.lastError }}</p>
          </div>
        </transition>
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}

.settings-header {
  padding: 2.5rem 1.25rem 1.5rem;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}

.header-title h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 0.95;
}

.header-subtitle {
  margin: 0.75rem 0 0;
  color: var(--muted-foreground);
  line-height: 1.7;
}

.settings-content {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 0 1.25rem 4rem;
}

.settings-stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.status-card,
.form-card {
  border: 1px solid var(--border);
  background: var(--card);
}

.card-body,
.form-section {
  padding: 1.25rem;
}

.card-body {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.status-icon-box,
.status-tile-icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.status-info h3,
.status-tile-copy strong {
  margin: 0;
  font-size: 1rem;
}

.status-info p,
.status-tile-copy p,
.form-hint span,
.endpoint-label,
.header-subtitle,
.error-log p {
  color: var(--muted-foreground);
}

.status-info p,
.status-tile-copy p,
.error-log p {
  margin: 0.4rem 0 0;
  line-height: 1.7;
}

.status-ok {
  border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
}

.status-error {
  border-color: color-mix(in srgb, #d04d4d 38%, var(--border));
}

.status-muted {
  border-color: var(--border);
}

.status-warn {
  border-color: color-mix(in srgb, #e4a63b 38%, var(--border));
}

.section-header {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.9rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 600;
}

.endpoint-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}

.endpoint-tile,
.status-tile {
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--secondary) 65%, transparent);
}

.endpoint-tile {
  padding: 0.9rem 1rem;
}

.endpoint-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.endpoint-tile strong {
  display: block;
  word-break: break-word;
}

.form-hint {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-top: 1rem;
  font-size: 0.875rem;
  line-height: 1.6;
}

.section-divider {
  height: 1px;
  background: var(--border);
}

.card-footer {
  padding: 0 1.25rem 1.25rem;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.action-btn {
  width: 100%;
}

.theme-switcher {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 3rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.theme-option:hover,
.theme-option-active {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
  color: var(--foreground);
  background: color-mix(in srgb, var(--secondary) 80%, transparent);
}

.status-tile {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding: 1rem;
  margin-top: 1rem;
}

.error-log {
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in srgb, #d04d4d 38%, var(--border));
  border-radius: 1rem;
  background: color-mix(in srgb, #d04d4d 8%, var(--card));
}

.error-header {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 700;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .endpoint-grid,
  .theme-switcher,
  .action-grid {
    grid-template-columns: 1fr;
  }

  .settings-header,
  .settings-content {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}
</style>

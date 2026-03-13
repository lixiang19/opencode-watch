<script setup lang="ts">
import { computed } from 'vue'
import {
  BellRing,
  CircleAlert,
  Download,
  FolderOpen,
  Info,
  Link2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  User
} from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Card from '@/components/ui/card/Card.vue'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()

const connectionTone = computed(() => (app.streamReady ? 'status-ok' : 'status-error'))
const serverEndpoint = computed(() => {
  try {
    const url = new URL(app.serverUrl)
    return {
      origin: url.origin,
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80')
    }
  } catch {
    return {
      origin: app.serverUrl,
      host: '--',
      port: '--'
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
        <p class="header-subtitle">管理您的服务连接与应用配置</p>
      </div>
    </header>

    <main class="settings-content">
      <div class="settings-stack">
        <!-- 运行状态卡片 -->
        <Card class="status-card" :class="connectionTone">
          <div class="card-body">
            <div class="status-icon-box">
              <ShieldCheck v-if="app.streamReady" class="h-6 w-6" />
              <CircleAlert v-else class="h-6 w-6" />
            </div>
            <div class="status-info">
              <h3>{{ app.connectionStateLabel }}</h3>
              <p>{{ app.streamReady ? '服务已就绪，所有功能均可正常使用。' : '连接遇到问题，请检查网络或配置信息。' }}</p>
            </div>
          </div>
        </Card>

        <!-- 基础配置卡片 -->
        <Card class="form-card">
          <div class="form-section">
            <div class="section-header">
              <Link2 class="h-4 w-4" />
              <span>服务连接</span>
            </div>
            <div class="form-group">
              <label>opencode 地址</label>
              <Input v-model="app.serverUrl" placeholder="http://127.0.0.1:4096" autocomplete="url" />
            </div>
            <div class="endpoint-grid">
              <div class="endpoint-tile">
                <span class="endpoint-label">当前地址</span>
                <strong>{{ serverEndpoint.origin }}</strong>
              </div>
              <div class="endpoint-tile">
                <span class="endpoint-label">主机</span>
                <strong>{{ serverEndpoint.host }}</strong>
              </div>
              <div class="endpoint-tile">
                <span class="endpoint-label">端口</span>
                <strong>{{ serverEndpoint.port }}</strong>
              </div>
            </div>
            <div class="form-hint">
              <Info class="h-3 w-3" />
              <span>会话列表和实时推送只来自当前连接的这一个 opencode 服务实例。</span>
            </div>
          </div>

          <div class="section-divider"></div>

          <div class="form-section">
            <div class="section-header">
              <User class="h-4 w-4" />
              <span>身份认证</span>
            </div>
            <div class="form-group">
              <label>账号</label>
              <Input v-model="app.username" placeholder="请输入账号" autocomplete="username" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <Input
                v-model="app.password"
                type="password"
                placeholder="请输入密码"
                autocomplete="current-password"
              />
            </div>
            <div class="form-hint">
              <Info class="h-3 w-3" />
              <span>账号密码仅用于本地认证，不会明文存储。</span>
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
              <Button variant="outline" class="action-btn" :disabled="app.isRefreshing" @click="app.refreshSessions({ reopen: false })">
                <RefreshCw class="h-4 w-4 mr-2" :class="app.isRefreshing ? 'animate-spin' : ''" />
                同步数据
              </Button>
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

        <!-- 错误日志 -->
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
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
}

.header-title h1 {
  font-size: 2rem;
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.03em;
}

.header-subtitle {
  color: var(--muted-foreground);
  margin-top: 0.5rem;
  font-size: 0.9375rem;
}

.settings-content {
  flex: 1;
  padding: 0 1rem 3rem;
}

.settings-stack {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 800px;
  margin: 0 auto;
}

/* 状态卡片 */
.status-card {
  border-radius: 1.25rem;
  border-left-width: 6px;
  transition: all 0.3s ease;
}

.status-ok {
  border-left-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 3%, var(--card));
}

.status-error {
  border-left-color: var(--destructive);
  background: color-mix(in srgb, var(--destructive) 3%, var(--card));
}

.status-warn {
  border-left-color: var(--ring);
  background: color-mix(in srgb, var(--ring) 6%, var(--card));
}

.status-muted {
  border-left-color: var(--border);
  background: color-mix(in srgb, var(--muted) 36%, var(--card));
}

.card-body {
  padding: 1.5rem;
  display: flex;
  gap: 1.25rem;
  align-items: center;
}

.status-icon-box {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  background: var(--background);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

.status-ok .status-icon-box {
  color: var(--primary);
}

.status-error .status-icon-box {
  color: var(--destructive);
}

.status-info h3 {
  font-size: 1.0625rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
}

.status-info p {
  font-size: 0.875rem;
  color: var(--muted-foreground);
  margin: 0;
  line-height: 1.5;
}

/* 表单卡片 */
.form-card {
  border-radius: 1.25rem;
  overflow: hidden;
}

.form-section {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--foreground);
}

.form-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--muted);
  border-radius: 0.75rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.endpoint-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.endpoint-tile {
  display: grid;
  gap: 0.35rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--muted) 28%, var(--card));
}

.endpoint-label {
  font-size: 0.75rem;
  color: var(--muted-foreground);
}

.endpoint-tile strong {
  font-size: 0.9375rem;
  line-height: 1.35;
  word-break: break-all;
}

.section-divider {
  height: 1px;
  background: var(--border);
  margin: 0 1.5rem;
  opacity: 0.5;
}

.card-footer {
  background: color-mix(in srgb, var(--muted) 20%, transparent);
  padding: 1.25rem 1.5rem;
}

.action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.action-btn {
  height: 2.75rem;
  font-weight: 600;
  border-radius: 0.75rem;
}

.status-tile {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--card) 92%, white);
}

.status-tile-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.875rem;
  background: var(--background);
}

.status-tile-copy {
  display: grid;
  gap: 0.25rem;
}

.status-tile-copy strong {
  font-size: 0.9375rem;
}

.status-tile-copy p {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  line-height: 1.6;
}

/* 错误日志 */
.error-log {
  padding: 1.25rem;
  background: color-mix(in srgb, var(--destructive) 5%, var(--background));
  border: 1px solid color-mix(in srgb, var(--destructive) 20%, var(--border));
  border-radius: 1rem;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--destructive);
  font-size: 0.8125rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.error-log p {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  color: color-mix(in srgb, var(--destructive) 80%, var(--foreground));
  margin: 0;
  word-break: break-all;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .endpoint-grid {
    grid-template-columns: 1fr;
  }

  .action-grid {
    grid-template-columns: 1fr;
  }
}
</style>

# 发现与决策

## 需求
- 全局安装并接入 Pinia
- 首页进入时就预取 Agent / 模型 / 命令
- 继续“拆”，也就是去掉当前兼容包装层，直接用 store

## 研究发现
- 当前 `App.vue` 之前通过 `provide/inject` 注入状态，不是真正的全局 store
- `useOpencodeApp.ts` 已承载全部状态与 action，适合作为 Pinia setup store 的实现体
- 首页路由对应 `src/pages/ConversationListView.vue`
- 受影响组件主要集中在聊天页、会话页、项目页、设置页
- 组件直接使用 Pinia store 时，应去掉原来的 `.value` 访问方式，改为 Pinia 代理值

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 保留 `useOpencodeApp.ts` 作为 store 实现体 | 避免大规模搬迁 1500+ 行逻辑，先拆掉外层兼容层 |
| 组件直接使用 `useOpencodeStore()` | 符合用户“拆”的要求，减少中间层 |
| 删除 `src/lib/app-context.ts` | 兼容层已经没有存在价值，会增加认知负担 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| npm 全局缓存权限错误 | 使用仓库内本地缓存安装 Pinia |
| 兼容层仍被多个页面依赖 | 统一替换组件导入与访问方式 |
| 模板与脚本大量依赖 `.value` | 统一迁移为 Pinia 代理值访问 |

## 资源
- `src/stores/opencode.ts`
- `src/composables/useOpencodeApp.ts`
- `src/pages/ConversationListView.vue`
- `src/components/chat/ChatComposer.vue`
- `src/pages/ChatView.vue`

## 视觉/浏览器发现
- 当前问题核心不是视觉，而是状态初始化与数据拉取时机

# 发现与决策

## 需求
- 用户明确要求优先优化聊天页性能
- 重点场景是消息极其多时的进入会话、滚动和流式更新
- 需要在当前项目架构上实现，不引入冗余兜底逻辑

## 研究发现
- `session.messages({ sessionID })` 当前会一次性拉全量历史
- SDK 的 `session.messages()` 实际支持 `limit?: number`，可以直接只取最近 N 条
- `ChatView` 当前直接 `v-for` 渲染全部消息，没有虚拟列表
- `ChatView` 对 `app.messages.value` 做了 `deep: true` 监听，流式文本更新时会频繁触发滚到底
- `MessageBubble` 很轻，但当 DOM 数量很大时，节点总量仍然是主要瓶颈
- 项目当前没有现成的虚拟滚动依赖

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 优先使用 SDK 自带的 `session.messages({ limit })` | 直接减少接口返回量、转换成本和首屏渲染成本 |
| 优先限制首屏渲染消息窗口 | 不需要后端改造，能直接降低 map、diff、DOM 成本 |
| 自动滚动改为基于消息数量和末条内容变化的轻监听 | 比 deep watch 更省，且足够覆盖聊天场景 |
| 先不引入第三方虚拟列表库 | 当前项目无依赖，先用原生策略快速拿到收益 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 历史消息接口是否支持分页未知 | 先在前端做窗口裁剪，避免依赖未知 API |

## 资源
- `src/composables/useOpencodeApp.ts`
- `src/pages/ChatView.vue`
- `src/components/chat/MessageBubble.vue`
- `package.json`
- `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts:543`

## 视觉/浏览器发现
- 聊天气泡当前结构简单，性能瓶颈主要不在单个组件，而在消息数量、监听频率和全量滚动。

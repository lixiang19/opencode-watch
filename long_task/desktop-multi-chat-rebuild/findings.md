# 发现与决策

## 需求
- 从底层修复桌面端多 chat 的问题，而不是只修表面 bug。
- 桌面端功能要真正可用，支持多会话并行打开和操作。
- 保持现有单 chat 能力可继续工作，避免明显回归。

## 研究发现
- 桌面端入口在 `src/pages/DesktopWarRoomView.vue`，当前只是多窗口 UI 壳，底层仍依赖单会话 store。
- 当前真正的运行态只有一份：`selectedSessionId`、`messages`、`isSending`、`sessionStatus`、`lastError` 都是全局单例，定义在 `src/composables/useOpencodeApp.ts`。
- 桌面窗口只有非激活会话的 preview cache：`sessionPreviewMessages`；因此现在本质是“1 个真实会话 + 多个静态预览窗口”。
- 桌面页用重写 `router.push` 的方式把“打开会话”从路由行为劫持成 panel 行为，属于脆弱实现。
- panel 内发送消息、加载历史都要先切换全局 `selectedSessionId`，这是多窗口串状态的根源。

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 为桌面端引入按 `sessionId` 存储的运行态映射 | 发送中、加载中、错误、消息列表都必须按窗口隔离 |
| 保留单 chat 的 `selectedSessionId` 流程，但让桌面端尽量不依赖它 | 兼顾现有路由页，缩小改动范围 |
| 把桌面端“打开会话”改成显式动作，不再依赖 router monkey patch | 路由劫持很脆，且会隐藏真实控制流 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 现有 store 把会话数据、UI 运行态、聊天选项都耦合在一起 | 先梳理最小拆分边界，优先抽出桌面会话运行态 |

## 资源
- `src/pages/DesktopWarRoomView.vue`
- `src/composables/useOpencodeApp.ts`
- `src/components/chat/ChatPane.vue`
- `src/components/chat/ChatComposer.vue`
- `src/pages/ConversationListView.vue`
- `src/pages/ProjectsView.vue`

## 视觉/浏览器发现
- 暂无，本阶段主要是代码实现梳理。

---
*每 2 次查看/浏览器/搜索操作后更新此文件*

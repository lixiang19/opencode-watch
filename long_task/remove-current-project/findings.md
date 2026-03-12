# 发现与决策

## 需求
- 删除当前项目这个概念，避免项目列表里出现“当前”。
- 保留项目页和新建对话能力，但交互应改成普通项目列表，而不是“当前项目”列表。

## 研究发现
- `src/pages/ProjectsView.vue` 直接用 `app.draftDirectory.value === project.directory` 渲染“当前”标签。
- `src/composables/useOpencodeApp.ts` 用 `draftDirectory` 表示手动输入/待创建目录，同时 `activeProjectDirectory` 又会回退到当前会话目录，导致 UI 很容易出现“当前项目”语义。
- `openSession()` 会把会话目录回写到 `draftDirectory`，这让“草稿目录”和“当前会话目录”混在一起。

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 将“草稿输入目录”与“当前会话目录”彻底分离 | 这样项目列表不需要再标记“当前”，状态含义也更单一 |
| 项目卡片点击仅填充草稿目录，不再显示选中态标签 | 满足删除概念诉求，同时保留快捷新建对话交互 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 工作区存在未提交修改 | 只改与本需求直接相关的文件，避免覆盖既有变更 |

## 资源
- `src/pages/ProjectsView.vue`
- `src/composables/useOpencodeApp.ts`
- `src/components/chat/ChatHeader.vue`
- `src/pages/ConversationListView.vue`

## 视觉/浏览器发现
- 无

---
*每 2 次查看/浏览器/搜索操作后更新此文件*

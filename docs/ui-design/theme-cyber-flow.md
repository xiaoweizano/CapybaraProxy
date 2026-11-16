# A 主题：Cyber Flow（默认）

## 1. 视觉关键词

深海蓝、石墨黑、蓝紫霓虹、能量球、网络空间、流动粒子、清晰的数据面板。

## 2. 色彩 tokens（初始建议值）

以下为实现起点，Codex 应先抽成 tokens，再通过截图对照微调：

- `bg.canvas`: `#080F2B`
- `bg.sidebar`: `#101A43`
- `surface.primary`: `#111D49`
- `surface.elevated`: `#172653`
- `accent.blue`: `#168CFF`
- `accent.cyan`: `#22D9FF`
- `accent.violet`: `#765CFF`
- `status.connected`: `#12D99A`
- `status.warning`: `#FFB547`
- `status.error`: `#FF5478`
- `text.primary`: `#F3F6FF`
- `text.secondary`: `#A8B5D8`
- `border.subtle`: `rgba(130,165,255,0.18)`

这些是起始 tokens，不代表参考图的最终取色；应以参考图取色和视觉对比为准。

## 3. 主视觉 Orb

- 圆形球体，蓝色外缘辉光、紫色内部流线。
- 连接状态由真实 Runtime 状态驱动。
- `connected`：柔和呼吸光和低频流动。
- `starting`：短暂聚合/启动动画。
- `stopped`：降低亮度，不继续高频粒子动画。
- `error`：明确错误状态，不能只靠颜色表达。
- 优先 CSS/SVG；确有必要时使用 Canvas。禁止默认使用持续高负载 WebGL 场景。

## 4. 卡片与图表

- 深色半透明/渐层面板，微弱描边和柔和阴影。
- 实时曲线使用低成本 Canvas 或轻量 SVG。
- 数据变化采用局部更新。
- 地图保持暗色底图和有限数量的节点光点。
- 延迟环形仪表以数值和单位为主，动画为辅。

## 5. 动效原则

- 启动、连接、断开、切换节点时使用短促反馈。
- 稳定连接时动画降频或静止。
- `prefers-reduced-motion` 生效。
- 窗口隐藏、页面不活动或系统节能模式下暂停非必要动画。

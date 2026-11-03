---
name: globe-3d
description: 基于内置 Three.js 地球模板创建或定制通用 3D 地理数据可视化网页，保留暗色玻璃面板、真实地球贴图、大气光晕、脉冲标记和地点标签，支持 JSON、CSV、HTTP API 接入。用于“用地球展示这些地点/客户/事件”“生成同款 3D 地球”；不用于 GIS 精密分析、自动新闻采集或无坐标资料的自动定位。
---

# 通用 3D 地球

使用 `assets/template/` 中的可运行源码生成独立项目。保留现有地球与面板的视觉系统；仅按用户需求更换品牌、数据、分类和适配。不从零重做外观，不修改原始参考项目。

## 创建与运行

1. 确定输出目录与输入资料。有明确数据直接处理；没有数据时生成默认空地球，不自动添加演示业务数据。
2. 执行 `python3 <本 Skill 目录>/scripts/create_project.py <新的输出目录>`，脚本拒绝覆盖已有目录。
3. 在生成项目执行 `npm ci`，然后 `npm run dev -- --port <空闲端口>`。依赖 Node.js 22.18+，建议 24+；测试使用原生 TypeScript stripping。
4. 浏览器打开实际启动地址，检查地球、标签、分类筛选、详情与接入状态。构建用 `npm run build`；接入逻辑修改后用 `npm test`。

## 接入数据

先读 [references/data-contract.md](references/data-contract.md)。JSON/CSV/API 共用 `src/app/utils/data.ts` 的校验与转换。

- JSON：对象数组；嵌套对象通过 `dataPath` 指向数组。
- CSV：UTF-8、逗号分隔，首行为表头；支持 BOM、CRLF、引号、引号内换行。
- API：HTTP(S) GET 返回 JSON 或 CSV；页面可配置 URL、格式、数组路径、字段映射、刷新频率。默认手动刷新，连接成功后才按所选频率轮询。无需新闻后端或数据库。
- 不同字段名优先通过面板的 JSON 映射配置适配；需要长期预设时修改独立副本的初始化配置。用户未要求时不另建插件框架。
- 对需要密钥的 API，先检查实际 API 文档，在生成项目中增加最小服务端代理。不要把密钥写进浏览器代码、URL、公开配置、Skill 包或日志。
- 无经纬度的资料不能直接上图。先核实坐标来源或询问用户；不猜测、不默默映射到国家中心，也不调用未经授权的定位服务。

## 保留的视觉与行为

地球场景在 `src/app/GlobeApp.tsx`；玻璃面板样式在 `src/styles/globals.css`，数据交互样式在 `src/styles/data.css`。品牌在 `src/globe.config.ts`；分类从数据生成，颜色由 `categoryHex()` 确定。地球贴图已本地化至 `public/textures/`。

默认空状态。示例只放在 `public/examples/`，标为虚构、由用户主动导入。不得添加原项目的新闻样本、GDELT/Finnhub/NewsAPI/Polymarket 标识、模拟 LIVE 状态、固定军事财经分类或后台采集任务。

导入失败应显示错误并保留上次成功数据；不以模拟数据掩盖故障。数据成功刷新时间与事件时间分开显示。历史数据和无日期地点必须可见；时间滑块按当前数据的最早至最晚日期筛选，无日期记录始终显示。

## 验证与交付

按 [references/verification.md](references/verification.md) 做与变更相称的检查，报告真实通过项和限制。JSON 与 CSV 至少各导入一次，API 检查成功、空数组和失败响应。空数据时仍需看见地球，不请求任何默认信息源。

交付独立项目路径与可打开的预览地址；需要分享时打包项目源码及锁文件，排除依赖、构建输出、环境文件、缓存和用户私有数据。Skill 自身是模板和接入指导，不是长期运行的采集服务。

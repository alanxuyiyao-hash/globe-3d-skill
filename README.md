# Globe 3D Skill · 通用 3D 地球

A reusable agent skill for building interactive Three.js globes from JSON, CSV, or HTTP APIs. Includes the complete runnable template, data adapters, and tests.

保留真实地球贴图、暗色玻璃面板、大气光晕、脉冲标记与地点标签。默认空地球，不绑定新闻服务，不内置业务数据或密钥。

## 安装 Skill

需要 Git、Python 3，以及 Node.js 22.18+（建议 24+）。以下以 `~/.agents/skills` 为安装目录示例，使用其他工具时按其技能目录约定调整。

```bash
git clone https://github.com/alanxuyiyao-hash/globe-3d-skill.git ~/.agents/skills/globe-3d
```

如果该目录已经存在，请先选择另一个安装位置，避免覆盖本地修改。安装后在新会话中调用：

> 使用 $globe-3d，把我的 JSON / CSV 做成一个 3D 地球，保留模板的视觉效果。

也可以让支持 GitHub 安装的 Skill 安装器从本仓库根目录安装，Skill 入口为 [SKILL.md](SKILL.md)。

## 生成独立项目

```bash
python3 ~/.agents/skills/globe-3d/scripts/create_project.py ./my-globe
cd my-globe
npm ci
npm run dev
```

脚本拒绝覆盖已有目录；生成后按终端输出打开本机地址。也可直接进入 `assets/template` 执行 `npm ci` 与 `npm run dev` 查看模板。

## 支持的数据

- JSON 文件：对象数组，支持嵌套数组路径与字段映射。
- CSV 文件：UTF-8，逗号分隔，支持引号、换行与 BOM。
- HTTP API：GET JSON 或 CSV；支持手动刷新、30 秒 / 60 秒 / 5 分钟轮询。

最小 JSON：

```json
[
  {"id":"point-1","title":"示例地点（虚构）","lat":31.2304,"lng":121.4737,"category":"展示组 A","location":"上海"}
]
```

必填 `title`、`lat`、`lng`。可选分类、时间、地点名称、描述、来源、关联链接与显示权重。没有坐标的资料需先获得可靠坐标，模板不自动猜测地点。

面板“字段映射 / 数组路径”可配置：

```json
{"dataPath":"data.items","fields":{"title":"name","lat":"latitude","lng":"longitude"}}
```

完整约定见 [数据格式与 API 接入](references/data-contract.md)。虚构示例在 [JSON](assets/template/public/examples/locations.json) 和 [CSV](assets/template/public/examples/locations.csv)，需主动导入。

## 行为与限制

分类从数据生成；支持分类筛选、时间截止筛选、点击详情、拖拽旋转和滚轮缩放。历史数据和无日期地点可正常展示。读取失败会保留上次成功数据并明确报错，不填充模拟新闻。

单批最多 10 MiB / 10,000 条，地球最多绘制 180 条，列表可加载更多。默认只接入一个当前数据集；多源需先在适配层合并。页面刷新不保留用户数据或连接配置。

API 跨域访问取决于服务端 CORS。包含密钥的接口应经服务端代理接入。Skill 不包含长期采集服务、自动地理编码、WebSocket 或 GIS 精密分析。

## 验证

在生成项目或 `assets/template` 中：

```bash
npm run build
npm test
```

测试覆盖 JSON / CSV 解析、字段映射、坐标与时间校验、HTTP 响应、取消请求与体积限制。HTTP 测试需要允许本机临时端口监听。

## 许可

代码采用 [MIT License](LICENSE)。地球贴图来源及上游许可证见 [素材来源](assets/template/ASSET-SOURCES.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。npm 依赖遵循各自许可证。

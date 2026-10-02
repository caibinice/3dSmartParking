# 智慧停车三维数字孪生

Angular 21 + Babylon.js 9 的全屏沉浸式前端演示。桌面与手机使用同一精细园区的不同 LOD，保留建筑、道路、窗户和车辆材质；统计、图表、记录与设置默认隐藏，点击底部操作栏才展开。

- [桌面版](https://caibinice.com/smartParking/)
- [手机版](https://caibinice.com/smartParking/mobile)
- [源码](https://github.com/caibinice/3dSmartParking)
- [优化记录](docs/optimization-plan.md)
- [验证记录](docs/test-results.md)

## 本地运行

需要 Node.js 20.19+ / 22.12+ / 24.0+；本次验证版本为 24.14.1。

```powershell
npm ci
npm start
# http://localhost:8699/
# http://localhost:8699/mobile
npm run typecheck
npm test
npm run build
```

生产 base 路径为 `/smartParking/`；根路径静态预览使用 `npm run build:local`。

## 沉浸交互

- 默认全屏三维画布，底部圆形菜单打开数据、分区、记录、提醒、视角、设置浮层；浮层不改变画布尺寸。
- 拖动旋转、滚轮缩放、右键平移；点击区域定位点平滑飞入，可回到全景、俯视或自动巡航。
- 点击真实车辆实例进入近景；巡行演示沿原始园区道路运动，支持镜头跟随与暂停。
- 模拟泊位推荐、记录筛选/CSV 导出、告警确认；纯净模式隐藏信息层，Esc 关闭浮层或恢复操作界面。
- 手机单指旋转、双指缩放；竖屏自动呈现横向场景，点击全屏后尝试系统横屏锁定。
- 自动画质以清晰度优先：默认 2× CSS 像素，移动/桌面像素预算分别为 400 万/800 万；持续低帧率时先减少光效与绘制频率，不自动降到原生分辨率以下。
- 默认 WebGL2，`?renderer=webgpu` 显式选择 WebGPU；能力检测和后端初始化发生在模型加载之前。

## 精细资产与脱敏

| 发布资源 | 字节数 | 图像纹理 |
|---|---:|---:|
| 桌面园区 | 18,953,916 | 18 |
| 手机园区 | 16,444,988 | 18 |
| 桌面车辆模板 | 1,416,044 | 7 |
| 手机车辆模板 | 1,357,092 | 7 |

原始默认园区为 164,807,820 字节。通过共享车辆模板、126 辆 thin instances、静态网格按材质合批和保守减面，桌面/手机园区与车辆的合计发布体积约为 20.37 MB / 17.80 MB。手机版保留同样的材质层次，不以盒体园区替代原建模。

网页使用某某公司、某某医院；模型招牌节点和楼体内嵌文字几何单独清理，动态双面招牌为“某某中医院”。删除供应商水印和带游戏品牌的车牌纹理，其余精细纹理保留。旧开场/监控视频、真实监控地址不发布。脱敏检查包含源码、GLB 元数据与近景视觉检查。

模型中的 126 辆停放车辆保留原始布局。300 个泊位为演示统计口径，不与模型实例逐个映射；统计数据、告警、记录和巡行行为均为模拟，未连接真实设备。

## 代码结构

- `src/app/core/parking-data.ts`：数据契约、模拟纯函数与分辨率预算。
- `src/app/core/parking-store.ts`：signals 演示状态。
- `src/app/core/parking-scene.ts`：资产、渲染、相机飞行、实例拾取、触控与释放。
- `src/app/dashboard/`：全屏场景界面与按需信息浮层。
- `scripts/optimize-model.mjs`：从外部原始资产生成桌面/手机 LOD、实例矩阵和道路轨迹。
- `scripts/audit-assets.mjs`：纹理保留、名称脱敏、体积、实例与轨迹契约。
- `scripts/deploy.py`：带备份和回滚的原子静态 release 发布。

重新生成模型时提供外部原资产，原文件不进入公开仓库：

```powershell
npm run optimize:model -- "SOURCE_CAMPUS.glb" "SOURCE_VEHICLE.glb"
```

## 发布与提交

兄弟目录保留 `ai-blog` 与 `ai-quantitative-trading`，共享凭据只放博客的忽略文件 `credentials.txt`。

```powershell
npm run build
E:\codes\ai-quantitative-trading\.venv\Scripts\python.exe scripts\deploy.py
E:\codes\ai-blog\scripts\github-push.ps1 -Project parking -Message "Your commit message" -Files README.md,src,scripts,docs,deploy,public,package.json,package-lock.json,angular.json
```

Nginx 片段在 `deploy/nginx-location.conf`；发布静态 gzip、指纹 JS/CSS 和版本化 GLB，手机深链接可直接刷新。服务器保留旧 release 与配置备份；共享提交脚本使用 token 和本地 `http://127.0.0.1:20808` 代理，不把凭据写入仓库。

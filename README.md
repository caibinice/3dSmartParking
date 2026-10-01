# 智慧停车三维数字孪生

Angular 21 + Babylon.js 9 的独立前端演示，保留脱敏园区模型并提供手机专用轻量场景。

- [在线桌面版](https://caibinice.com/smartParking/)
- [在线手机版](https://caibinice.com/smartParking/mobile)
- [源码](https://github.com/caibinice/3dSmartParking)
- [优化记录](docs/optimization-plan.md)
- [验证记录](docs/test-results.md)

## 运行
需要 Node.js 20.19+ / 22.12+ / 24.0+（当前验证24.14.1）。
```powershell
npm ci
npm start
# http://localhost:8699
npm run typecheck
npm test
npm run build
```
生产base路径为 /smartParking/；根路径静态测试可使用npm run build:local。

## 能力
统一模拟数据、区域定位、车位推荐、俯视与巡航、告警确认、记录筛选/CSV导出、四档画质、实际FPS、后台暂停、模型加载进度与轻量降级。默认WebGL，支持?renderer=webgpu显式选择现代后端。

手机版位于/mobile：程序化低面数楼体，不下载桌面GLB；单指旋转、双指缩放，竖屏自动转换为横向工作台。点击全屏会尝试系统landscape锁定，浏览器限制时保留页面横向布局。

## 结构
- src/app/core/parking-data.ts：纯函数与数据契约
- src/app/core/parking-store.ts：signals演示状态
- src/app/core/parking-scene.ts：引擎、资产、实例化、触控与销毁
- src/app/dashboard/：桌面和手机展示
- scripts/optimize-model.mjs：外部原模型转脱敏发布GLB
- scripts/deploy.py：静态release部署

公开模型为某某医院园区，动态招牌为某某中医院，页脚使用某某公司。原开场/监控视频、真实名称纹理、高面数车辆与重复模型均已移出公开工程。页面的指标和记录明确为演示数据；三维车位数量为占用比例示意。

## 部署
在兄弟目录保留ai-blog与ai-quantitative-trading，共享凭据只放ai-blog/credentials.txt。
```powershell
npm run build
E:\codes\ai-quantitative-trading\.venv\Scripts\python.exe scripts\deploy.py
```
Nginx配置片段在deploy/nginx-location.conf。默认读取已有平台RemoteClient，不把token或服务器密码写入代码。

## 提交
```powershell
E:\codes\ai-blog\scripts\github-push.ps1 -Project parking -Message "Your commit message" -Files README.md,src,scripts,docs,deploy,public,package.json,package-lock.json,angular.json,tsconfig.json,tsconfig.app.json,.gitignore
```
该脚本使用共享token与http://127.0.0.1:20808代理，支持新建空仓库首次提交。凭据、构建目录和浏览器临时截图不进入Git。

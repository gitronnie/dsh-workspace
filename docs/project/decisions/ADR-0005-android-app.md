# ADR-0005：独立原生 Android App

- 状态：accepted
- 日期：2026-08-14

## 决策

Android 客户端作为同级独立工程 `deepseek-harness-android` 开发，应用名为 DeepSeek Harness，包名为 `io.github.hakunm.deepseekharness`。UI 使用 Kotlin、Jetpack Compose 和 Material 3，默认中文并支持英文；启动图标复用 DSH WebUI 的 MIT 许可黑色鲸鱼路径。

App 只连接插件版本化 BFF。配对令牌由 Android Keystore 保护，Release 使用仓库外独立正式签名。DSH WebUI 功能对等通过显式能力矩阵逐项实现，不使用私有 `/api`、不暴露无约束通用 RPC，也不把 WebView 当作原生功能完成证明。

## 理由

独立工程避免插件 Host/Web 与 Android 构建、签名和发布资产混杂。Compose/Material 3 提供可测试的手机、平板和折叠屏原生界面；稳定 BFF 让 DSH 内部协议升级不直接破坏已发布 APK，并为移动设备权限、脱敏和审计保留明确边界。

# ADR-0001：独立外置插件

- 状态：accepted
- 日期：2026-08-14

## 决策

功能在独立仓库 `dsh-android-app-workspace` 中实现，同时声明 `dsh.bundle` 和 `dsh.client`，不修改 DSH 上游源码。

## 原因

官方 Profile bundle 和 Client module 机制已提供 Host/Client 双侧扩展、slot 和安装层。独立包可以通过 npm 或 tarball 提供预编译产物，降低升级耦合并满足 GitHub `dsh-plugin` topic 的安装预期。

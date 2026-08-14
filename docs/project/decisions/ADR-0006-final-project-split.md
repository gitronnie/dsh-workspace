# ADR-0006：正式版拆分与命名

- 状态：accepted
- 日期：2026-08-15

## 决策

正式发布拆分为两个独立 GitHub/Git 项目：插件和 npm 包统一命名为 `dsh-workspace`，Android 源码仓库命名为 `dsh-android-app`，应用显示名继续使用 `DeepSeek Harness`，包名继续使用 `io.github.hakunm.deepseekharness`。

两个项目的首个公开版本均为 `1.0.0`，Git 标签使用 `v1.0.0`。插件状态目录从旧开发名迁移为 `$DSH_HOME/dsh-workspace`；部署升级时复制已有数据库和回收站状态，不自动删除旧目录。

## 原因

插件和 App 的发布渠道、依赖、构建工具与使用者安装方式不同。独立仓库可以让 npm/GitHub topic、插件 tarball、APK Release、问题跟踪和版本节奏保持清晰，同时稳定的产品名比开发期组合名称更容易安装和记忆。

## 影响

- 正式插件安装命令为 `dsh plugin --profile web add dsh-workspace`。
- App 只依赖插件公开 `/api/v1`，不通过源码仓库耦合。
- 用户 README 分别面向插件管理员与 Android 用户。
- 两个仓库各自维护 CI、发布产物、版本展示和 Git 标签。

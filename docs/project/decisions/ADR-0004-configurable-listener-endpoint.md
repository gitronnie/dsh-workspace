# ADR-0004：可配置远程 listener endpoint

状态：accepted

## 决策

远程绑定目标由 `listener_host` 和 `listener_port` 两个 profile 范围 SQLite setting 持久化，默认是 `0.0.0.0:3090`。只接受数值 IPv4/IPv6 和 `1–65535` 端口，只有回环管理面可以修改。

关闭远程访问时 listener 绑定配置地址族的回环地址；启用时绑定配置目标。已启用状态不允许改 endpoint，重绑定时先尝试新 endpoint，失败后恢复旧 endpoint 且不提交配置。

## 理由

服务器可能有多张网卡、端口冲突、IPv6-only 网络或容器端口规划，固定 `0.0.0.0:3090` 不足以覆盖这些部署方式。域名是客户端连接标识而不是稳定的本机绑定目标，因此绑定设置不接受域名。

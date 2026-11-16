# 100day-vue

## Project Setup

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

### 登录部署

生产环境通过同源 HTTPS 代理将前端的 `/api/*` 转发到 Nest 后端，并去掉 `/api` 前缀。
代理需要透传 `Cookie` 和 `Set-Cookie`，后端使用 `NODE_ENV=production` 启用 `Secure` Cookie。
本地开发使用 Vite 已配置的 `/api` 代理。升级前仅保存在 `sessionStorage` 的登录态需要重新登录一次。

### GitHub Actions 发布到 ECS

PR 会检查类型并构建前端。合并或推送到 `main` 后，流水线会构建并发布到 [daybyday.omhelp.com](https://daybyday.omhelp.com)。也可以在 GitHub 仓库的 **Actions → Deploy frontend to ECS → Run workflow** 选择 `main` 重跑。

流水线将 `dist/` 发送给 ECS 上的 `daybyday_ci` 专用账号。该账号的 SSH 公钥只允许执行前端发布程序 `/usr/local/sbin/daybyday-frontend-deploy`，其源码位于 `deploy/publish-frontend.py`。对应私钥保存在仓库的 Actions Secret `DAYBYDAY_ECS_DEPLOY_KEY` 中，ECS 的 SSH 主机公钥固定在工作流中。

服务器将产物写入 `/var/www/daybyday/releases/` 的独立目录，再切换 `current` 链接。正式域名的入口页面、JS、CSS 或 API 检查失败时，发布程序会尝试恢复之前的前端版本。

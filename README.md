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

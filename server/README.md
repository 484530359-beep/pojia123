## Playground 接收服务

服务监听：

```text
http://156.239.47.60:18400/upload
```

健康检查：

```text
http://156.239.47.60:18400/health
```

服务端保存目录：

```text
/var/lib/hanshuang-playground/
```

客户端只使用公开 HTTP 上传地址，不包含 SSH 私钥、服务器私钥或登录凭据。

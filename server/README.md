## HarnessKit Playground 接收服务

客户端默认上传地址：

```text
http://156.239.47.60:18400/upload
```

健康检查：

```text
http://156.239.47.60:18400/health
```

服务端默认保存目录：`/var/lib/harnesskit-playground/`。

客户端只使用公开 HTTP 上传地址，不包含 SSH 私钥、服务器私钥或登录凭据。可通过 `HK_UPLOAD_ENDPOINT` 和 `HK_UPLOAD_TOKEN` 覆盖默认客户端配置。

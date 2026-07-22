# BlammyTV site

The public marketing site — a fully static page (`index.html` + `assets/`),
served from an nginx container. No build step.

## Local preview

```sh
# Plain file server (any of these):
python -m http.server 8000        # → http://localhost:8000

# Or the real container, exactly as it runs in production:
docker build -t blammytv-site .
docker run --rm -p 8080:80 blammytv-site   # → http://localhost:8080
```

## Deploy (Coolify)

Deployed from the **`website`** branch as a Dockerfile resource.

| Setting            | Value            |
| ------------------ | ---------------- |
| Build Pack         | Dockerfile       |
| Branch             | `website`        |
| Base Directory     | `services/site`  |
| Dockerfile Location| `Dockerfile`     |
| Port               | `80`             |
| Health check path  | `/health`        |

To update the live site: land site changes on `website` and push — Coolify
redeploys on push (enable "Auto Deploy" on the resource).

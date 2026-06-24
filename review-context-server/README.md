# OpenCode Review Context Server

Standalone HTTP server for persisting multi-review session contexts across CI runs.

## Why

GitHub Actions `actions/cache` is immutable: once a cache key is written it cannot be updated. To work around this, `multi-review` uses a unique cache key per run and restores the most recent one. This works for GitHub-hosted runners, but if you prefer a self-hosted mutable store or need to share context across runners that cannot reach GitHub Actions cache, this server provides a simple key/value HTTP API backed by the local filesystem.

## API

All context endpoints are scoped by `owner/repo/pr`.

### `GET /health`

Health check.

```json
{ "status": "ok", "dataDir": "/data" }
```

### `GET /context/:owner/:repo/:pr`

Retrieve the saved review context. Returns `404` if none exists.

### `PUT /context/:owner/:repo/:pr`

Save (overwrite) the review context. Body must be valid JSON.

### `DELETE /context/:owner/:repo/:pr`

Delete the review context.

## Authentication

Set `AUTH_TOKEN` to require `Authorization: Bearer <token>` on all context endpoints. `/health` is always public.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` | Directory for persisted JSON files |
| `AUTH_TOKEN` | `""` | Optional bearer token |

## Deployment

### Local / systemd

```bash
cd review-context-server
npm install
npm run build
DATA_DIR=/var/lib/opencode-review-context AUTH_TOKEN=<token> npm start
```

### Docker

```bash
docker build -t opencode-review-context-server .
docker run -d \
  -p 8080:8080 \
  -v /srv/opencode-review-context:/data \
  -e AUTH_TOKEN=<token> \
  opencode-review-context-server
```

## Integration with multi-review

Configure the `multi-review` action inputs:

```yaml
- uses: sun-praise/opencode-actions/multi-review@v4
  with:
    context-cache-url: http://your-cache-server:8080
    context-cache-token: ${{ secrets.REVIEW_CONTEXT_TOKEN }}
```

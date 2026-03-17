---
name: deploy-gcp
description: >-
  Deploy FetMap application to GCP Compute Engine. Builds Docker images for
  linux/amd64, pushes to Artifact Registry, and updates containers on the
  production VM without touching PostgreSQL data. Use when the user asks to
  deploy, push to production, or update the server.
---

# FetMap GCP Deployment

## Infrastructure

| Component | Detail |
|-----------|--------|
| GCP Project | `nice-tiger-316923` |
| VM | `featmap-vm` (e2-micro, `us-central1-a`) |
| Registry | `us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo` |
| SSH user | `daniel@featmap-vm` |
| App user on VM | `danielcastro` |
| Compose dir | `/home/danielcastro/featmap` |
| DB data | `/home/danielcastro/featmap/data` (bind mount, **never delete**) |
| Domain | `backlog.arrenda1.com` |

### Services (docker compose)

| Service | Image source | Ports |
|---------|-------------|-------|
| `postgres` | `postgres:16-alpine` (stock) | 5432 (internal) |
| `featmap` | Registry `featmap:latest` | 5000 |
| `featmap-mcp` | Registry `featmap-mcp:latest` | 3000 |

## Deployment Workflow

### Pre-flight

1. **Check local changes** — `git status` and `git log --oneline -5`.
2. **Check migrations** — compare local `migrations/` with production schema version:

```bash
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo docker exec featmap-postgres-1 psql -U postgres -c 'SELECT version, dirty FROM schema_migrations;'"
```

Migrations are embedded via `go-bindata` and auto-applied on startup. Verify new `.up.sql` files use safe DDL (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.).

3. **Check server status**:

```bash
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo docker ps -a"
```

### Step 1 — Backup production DB

Always backup before deploying:

```bash
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo docker exec featmap-postgres-1 pg_dump -U postgres postgres > /tmp/backup_pre_deploy_\$(date +%Y%m%d_%H%M%S).sql && ls -lh /tmp/backup_pre_deploy_*.sql"
```

### Step 2 — Build images for linux/amd64

The VM is amd64. Mac ARM builds will cause `exec format error`. Always use `--platform linux/amd64`.

Build and push both in parallel:

```bash
# featmap (from repo root)
docker buildx build --platform linux/amd64 \
  -t us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap:latest \
  --push .

# featmap-mcp (from featmap-mcp/)
docker buildx build --platform linux/amd64 \
  -t us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap-mcp:latest \
  --push ./featmap-mcp
```

If push fails with auth errors, run locally first:

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
```

### Step 3 — Pull and recreate on server

Authenticate Docker on the VM, then pull and recreate **only app containers**:

```bash
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo bash -c '\
    gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin us-central1-docker.pkg.dev && \
    docker pull us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap:latest && \
    docker pull us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap-mcp:latest && \
    cd /home/danielcastro/featmap && \
    docker compose up -d --no-deps --force-recreate featmap featmap-mcp'"
```

**Critical flags:**
- `--no-deps` — does NOT restart postgres
- `--force-recreate` — picks up the new image

### Step 4 — Verify

```bash
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo docker ps -a && \
    sudo docker exec featmap-postgres-1 psql -U postgres -c 'SELECT version, dirty FROM schema_migrations;' && \
    sudo docker logs featmap-featmap-1 --tail 10 2>&1"
```

Confirm:
- All 3 containers are `Up` and `healthy`
- `schema_migrations.version` matches the latest migration number
- `dirty = f`
- Logs show `Serving on port 5000` with no errors

## Danger Zone

- **NEVER** run `docker compose down` or `docker compose up` without `--no-deps` — this recreates postgres and risks data loss if the volume mapping changes.
- **NEVER** delete `/home/danielcastro/featmap/data/`.
- **NEVER** build without `--platform linux/amd64` from an ARM Mac.
- **NEVER** skip the DB backup step.

## Rollback

If the new version fails, restore the previous image digest:

```bash
# Find previous digest
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap \
  --sort-by=~UPDATE_TIME --limit=5

# Pull specific digest and recreate
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo bash -c '\
    docker pull us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap@sha256:PREVIOUS_DIGEST && \
    docker tag us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap@sha256:PREVIOUS_DIGEST \
      us-central1-docker.pkg.dev/nice-tiger-316923/featmap-repo/featmap:latest && \
    cd /home/danielcastro/featmap && \
    docker compose up -d --no-deps --force-recreate featmap'"
```

If the DB migration is the problem, restore from backup:

```bash
gcloud compute ssh daniel@featmap-vm --zone=us-central1-a \
  --command="sudo bash -c '\
    cat /tmp/backup_pre_deploy_TIMESTAMP.sql | \
    docker exec -i featmap-postgres-1 psql -U postgres postgres'"
```

#!/usr/bin/env bash
# Deploy or roll back GrantApp on the VPS (docs/DEPLOY.md). Run as root:
#   bash /var/www/futurenestfund/deploy/deploy.sh            latest commit of $BRANCH (default user-side-redesign)
#   bash /var/www/futurenestfund/deploy/deploy.sh <commit>   that commit (rollback)
# Builds the API and the web app, runs database migrations, switches the web files in one step and reloads the API.
# Everything is inside main(), so bash has read the whole script before git checkout changes this file.
set -euo pipefail

main() {
  local APP=/var/www/futurenestfund WEB=/var/www/futurenestfund-web
  local REF=${1:-origin/${BRANCH:-user-side-redesign}}
  export PATH=/opt/futurenestfund-node/bin:$PATH

  cd "$APP"
  git fetch --prune origin
  git checkout --quiet --detach "$REF"
  local SHA
  SHA=$(git rev-parse --short HEAD)
  echo "== Deploying $SHA: $(git log -1 --format=%s)"

  # Only the packages the server needs (not the design sandbox), with exactly the locked versions.
  pnpm install --frozen-lockfile --filter '@workspace/api-server...' --filter '@workspace/grant-platform...' --filter '@workspace/scripts...'
  pnpm --filter @workspace/api-server run build
  # Vite's config wants PORT and BASE_PATH even for a build; the site is served from /.
  PORT=5000 BASE_PATH=/ pnpm --filter @workspace/grant-platform run build
  mkdir -p "$WEB/releases"
  rm -rf "$WEB/releases/$SHA"
  cp -a artifacts/grant-platform/dist/public "$WEB/releases/$SHA"

  echo "== Database migrations"
  # In a subshell, so the owner's database URL never reaches the running app.
  (set -a; . /etc/futurenestfund/api.env; . /etc/futurenestfund/migrate.env; set +a; pnpm --filter @workspace/scripts run db:migrate)

  echo "== Switching to $SHA"
  ln -sfn "releases/$SHA" "$WEB/current.new"
  mv -T "$WEB/current.new" "$WEB/current"
  APP_RELEASE=$SHA fnf-pm2 startOrReload "$APP/deploy/ecosystem.config.cjs" --update-env

  echo "== Health check"
  local port
  port=$(grep -E '^PORT=' /etc/futurenestfund/api.env | cut -d= -f2)
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/healthz"; then
      echo "OK: $SHA is live"
      # Remembered for the next boot (pm2-futurenestfund.service runs `pm2 resurrect`).
      fnf-pm2 save
      # Keep the five newest web releases.
      ls -1t "$WEB/releases" | tail -n +6 | while read -r old; do rm -rf "${WEB:?}/releases/$old"; done
      return 0
    fi
    sleep 1
  done
  echo "FAILED: the API did not answer on port $port. See: fnf-pm2 logs futurenestfund-api --lines 50" >&2
  echo "To roll back: bash $APP/deploy/deploy.sh <previous commit>   (git -C $APP log --oneline -5)" >&2
  return 1
}

main "$@"
exit

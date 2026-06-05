#!/usr/bin/env bash
#
# dev-up.sh — Start services defined in services.yaml.
#
# Usage:
#   ./dev-up.sh          Start active services + frontend dev server
#   ./dev-up.sh --no-fe  Start active services only
#   ./dev-up.sh down     Stop everything
#   ./dev-up.sh status   Show service status
#
set -euo pipefail
cd "$(dirname "$0")"

# ── Colors ──────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'
log()  { echo -e "${GREEN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[dev]${NC} $*"; }
err()  { echo -e "${RED}[dev]${NC} $*" >&2; }
dim()  { echo -e "${DIM}     $*${NC}"; }

SERVICES_FILE="services.yaml"

# ── Parse services.yaml ────────────────────────────────
get_active_services() {
  local current_key="" compose_name="" is_active="false"
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    if [[ "$line" =~ ^([a-zA-Z_-]+):$ ]]; then
      if [[ "$is_active" == "true" && -n "$current_key" ]]; then
        echo "${compose_name:-$current_key}"
      fi
      current_key="${BASH_REMATCH[1]}"
      compose_name=""
      is_active="false"
    fi
    [[ "$line" =~ ^[[:space:]]+active:[[:space:]]*(true|false) ]] && is_active="${BASH_REMATCH[1]}"
    [[ "$line" =~ ^[[:space:]]+compose_name:[[:space:]]*(.+) ]] && compose_name="${BASH_REMATCH[1]}"
  done < "$SERVICES_FILE"
  if [[ "$is_active" == "true" && -n "$current_key" ]]; then
    echo "${compose_name:-$current_key}"
  fi
}

is_service_active() {
  get_active_services | grep -qx "$1" || return 1
}

# ── Commands ────────────────────────────────────────────

cmd_status() {
  echo ""
  log "Service status (from services.yaml + Docker):"
  echo ""
  printf "  ${CYAN}%-20s %-10s %-20s${NC}\n" "SERVICE" "ENABLED" "DOCKER STATUS"
  printf "  %-20s %-10s %-20s\n" "-------" "-------" "-------------"

  local current_key="" is_active="" compose_name=""
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    if [[ "$line" =~ ^([a-zA-Z_-]+):$ ]]; then
      if [[ -n "$current_key" ]]; then
        local svc="${compose_name:-$current_key}"
        local docker_status
        docker_status=$(docker compose ps --format "{{.Status}}" "$svc" 2>/dev/null | head -1)
        [[ -z "$docker_status" ]] && docker_status="—"
        local active_display="no"
        [[ "$is_active" == "true" ]] && active_display="yes"
        printf "  %-20s %-10s %-20s\n" "$current_key" "$active_display" "$docker_status"
      fi
      current_key="${BASH_REMATCH[1]}"
      compose_name=""
      is_active="false"
    fi
    [[ "$line" =~ ^[[:space:]]+active:[[:space:]]*(true|false) ]] && is_active="${BASH_REMATCH[1]}"
    [[ "$line" =~ ^[[:space:]]+compose_name:[[:space:]]*(.+) ]] && compose_name="${BASH_REMATCH[1]}"
  done < "$SERVICES_FILE"
  if [[ -n "$current_key" ]]; then
    local svc="${compose_name:-$current_key}"
    local docker_status
    docker_status=$(docker compose ps --format "{{.Status}}" "$svc" 2>/dev/null | head -1)
    [[ -z "$docker_status" ]] && docker_status="—"
    local active_display="no"
    [[ "$is_active" == "true" ]] && active_display="yes"
    printf "  %-20s %-10s %-20s\n" "$current_key" "$active_display" "$docker_status"
  fi
  echo ""
}

cmd_down() {
  log "Stopping all services..."
  docker compose down --remove-orphans
  pkill -f "vite.*frontend" 2>/dev/null || true
  log "Done."
}

cmd_up() {
  local NO_FE=false
  [[ "${1:-}" == "--no-fe" ]] && NO_FE=true

  # ── Ensure .env exists ─────────────────────────────
  if [[ ! -f .env ]]; then
    warn ".env not found — creating from template..."
    cat > .env <<'ENVEOF'
# =============================================================
# civis — Environment Configuration
# Copy this file to .env and fill in the values marked CHANGE.
# Variables marked (auto) are written by setup-authentik.sh.
# =============================================================

# ── Authentik identity-provider DB ───────────────────────────
# Postgres instance used exclusively by Authentik.
PG_DB=authentik
PG_USER=authentik
PG_PASS=changeme-authentik-db-password        # CHANGE in production

# ── Application DB (Orchestrator + ConfigService) ────────────
# Shared Postgres instance for jobs, config, and user records.
APP_DB_NAME=civis
APP_DB_USER=civis
APP_DB_PASSWORD=civis                        # CHANGE in production
APP_DB_PORT=5400                               # Host port mapped to container 5432

# Alias vars used by OrchestratorAgent (same DB as above)
DB_NAME=civis
DB_USER=civis
DB_PASSWORD=civis

# Connection string for local (non-Docker) development.
# Inside Docker this is overridden by docker-compose environment section.
URL_DATABASE=postgresql://civis:civis@localhost:5400/civis

# ── Authentik server ──────────────────────────────────────────
AUTHENTIK_SECRET_KEY=changeme-generate-a-50-char-random-string  # CHANGE — run: openssl rand -hex 32
AUTHENTIK_BOOTSTRAP_PASSWORD=admin-changeme-2024                # CHANGE — first-run admin password
AUTHENTIK_BOOTSTRAP_TOKEN=auto-bootstrap-token-civis           # CHANGE in production

# Host ports for Authentik UI / API
COMPOSE_PORT_HTTP=9001
COMPOSE_PORT_HTTPS=9443

# Authentik image version (pin to avoid unexpected upgrades)
AUTHENTIK_TAG=2025.10.3

# ── JWT (issued to dashboard users after login) ───────────────
JWT_SECRET=civis-dev-secret-change-in-production  # CHANGE — run: openssl rand -hex 32
JWT_EXPIRE_HOURS=24

# ── Authentik OIDC URLs (host-side, used by browser/OrchestratorAgent) ──
# These use COMPOSE_PORT_HTTP above; update if you change that port.
AUTHENTIK_BASE_URL=http://localhost:9001
AUTHENTIK_HOST_URL=http://localhost:9001/api/v3
AUTHENTIK_TOKEN_URL=http://localhost:9001/application/o/token/
AUTHENTIK_AUTHORIZE_URL=http://localhost:9001/application/o/authorize/
AUTHENTIK_JWKS_URL=http://localhost:9001/application/o/civis/jwks/
AUTHENTIK_PROVIDER_URL=http://localhost:9001/api/v3/providers/oauth2/
AUTHENTIK_APPLICATION_URL=http://localhost:9001/api/v3/core/applications/
REDIRECT_URI=http://localhost:8000/auth/callback

# ── Authentik OIDC (auto-filled by setup-authentik.sh — do not edit manually) ──
AUTHENTIK_API_TOKEN=
CLIENT_ID=
CLIENT_SECRET=
AUTHORIZATION_FLOW_UUID=
INVALIDATION_FLOW_UUID=

# ── External AI APIs (optional — leave blank to skip) ────────
MEDGEMMA_API_URL=
MEDGEMMA_API_KEY=
WHISPERX_BASE_URL=
WHISPERX_API_KEY=
ENVEOF
    warn "Created .env — review it and change values marked CHANGE before starting."
    echo ""
  fi

  # ── Read active services ───────────────────────────
  local ACTIVE_SERVICES
  ACTIVE_SERVICES=$(get_active_services)

  # Exclude frontend from Docker services if user wants local dev server
  local DOCKER_SVCS=""
  for svc in $ACTIVE_SERVICES; do
    if [[ "$svc" == "frontend" && "$NO_FE" == "true" ]]; then
      continue
    fi
    DOCKER_SVCS="$DOCKER_SVCS $svc"
  done

  log "Active services:"
  for svc in $DOCKER_SVCS; do
    dim "$svc"
  done
  echo ""

  # ── Stop existing containers cleanly ───────────────
  log "Stopping existing containers..."
  docker compose down --remove-orphans 2>/dev/null || true
  pkill -f "vite.*frontend" 2>/dev/null || true

  # ── Start ALL active services in one call ──────────
  log "Starting all services..."
  docker compose up -d --build $DOCKER_SVCS

  # ── Wait for key services ──────────────────────────
  if is_service_active kafka; then
    log "Waiting for Kafka..."
    for _ in $(seq 1 30); do
      docker compose exec -T kafka sh -c "nc -z localhost 29092" 2>/dev/null && break
      sleep 2
    done
    log "Kafka ready."
  fi

  if is_service_active config-service; then
    log "Waiting for ConfigService..."
    for _ in $(seq 1 20); do
      curl -sf http://localhost:8010/health >/dev/null 2>&1 && break
      sleep 2
    done
    log "ConfigService ready."
  fi

  # Run config seed (waits for it to complete)
  if is_service_active config-seed; then
    log "Running config seed..."
    docker compose up config-seed 2>/dev/null || true
  fi

  if is_service_active server; then
    log "Waiting for Authentik (can take 30-60s)..."
    for i in $(seq 1 30); do
      curl -sf http://localhost:9001/-/health/ready/ >/dev/null 2>&1 && { log "Authentik ready."; break; }
      [[ $i -eq 30 ]] && warn "Authentik not ready yet — may still be starting."
      sleep 2
    done

    # Auto-configure OIDC if not yet done
    if [[ -z "$(grep -s 'AUTHENTIK_API_TOKEN=.' .env | grep -v '=$' || true)" ]]; then
      log "Running Authentik OIDC auto-setup..."
      bash ./setup-authentik.sh && {
        log "Restarting orchestrator with new OIDC tokens..."
        docker compose up -d --build orchestrator
      } || warn "Authentik setup failed — retry with: ./setup-authentik.sh"
    fi
  fi

  if is_service_active orchestrator; then
    log "Waiting for Orchestrator (port 8000)..."
    for i in $(seq 1 20); do
      curl -sf http://localhost:8000/docs >/dev/null 2>&1 && { log "Orchestrator ready."; break; }
      if [[ $i -eq 20 ]]; then
        warn "Orchestrator not ready — checking logs..."
        docker compose logs orchestrator 2>&1 | tail -5
      fi
      sleep 3
    done
  fi

  # ── Frontend dev server (if not using Docker) ──────
  if ! is_service_active frontend && [[ "$NO_FE" == "false" ]]; then
    log "Installing frontend dependencies..."
    (cd frontend && npm install)
    log "Starting frontend dev server (npm run dev)..."
    (cd frontend && npm run dev) &
    FE_PID=$!
    log "Frontend dev server running (PID: $FE_PID)"
  fi

  # ── Summary ────────────────────────────────────────
  echo ""
  log "========================================="
  log "  All active services are up!"
  log "========================================="
  echo ""
  is_service_active orchestrator   && echo "  Orchestrator:   http://localhost:8000  (Swagger: /docs)"
  is_service_active config-service && echo "  ConfigService:  http://localhost:8010  (Swagger: /docs)"
  is_service_active server         && echo "  Authentik:      http://localhost:9001"
  echo "  Frontend:       http://localhost:5173"
  echo ""
  echo "  Service config: services.yaml"
  echo "  Stop all:       ./dev-up.sh down"
  echo "  Status:         ./dev-up.sh status"
  echo ""

  # Authentik status
  if [[ -z "$(grep -s 'AUTHENTIK_API_TOKEN=.' .env | grep -v '=$' || true)" ]]; then
    warn "Authentik OIDC not configured. Run: ./setup-authentik.sh"
  else
    log "Authentik OIDC: configured"
  fi

  # Keep alive if frontend dev server is running
  if [[ -n "${FE_PID:-}" ]]; then
    wait "$FE_PID"
  fi
}

# ── Main ────────────────────────────────────────────────
case "${1:-up}" in
  down)   cmd_down ;;
  status) cmd_status ;;
  *)      cmd_up "$@" ;;
esac

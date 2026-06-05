FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY shared/ ./shared/
COPY OrchestratorAgent/pyproject.toml ./OrchestratorAgent/

RUN uv sync --frozen --package orchestrator-agent --no-dev

COPY OrchestratorAgent/ ./OrchestratorAgent/

RUN chmod +x OrchestratorAgent/entrypoint.sh

EXPOSE 8000

WORKDIR /app/OrchestratorAgent
CMD ["./entrypoint.sh"]

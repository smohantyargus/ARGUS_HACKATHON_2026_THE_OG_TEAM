FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY shared/ ./shared/
COPY GenericAgent/pyproject.toml ./GenericAgent/

RUN uv sync --frozen --package generic-agent --no-dev

COPY GenericAgent/ ./GenericAgent/

WORKDIR /app/GenericAgent
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8020"]

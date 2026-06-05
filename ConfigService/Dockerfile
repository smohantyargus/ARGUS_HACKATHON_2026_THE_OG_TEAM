FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY shared/ ./shared/
COPY ConfigService/pyproject.toml ./ConfigService/

RUN uv sync --frozen --package config-service --no-dev

COPY ConfigService/ ./ConfigService/

EXPOSE 8010

WORKDIR /app/ConfigService
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]

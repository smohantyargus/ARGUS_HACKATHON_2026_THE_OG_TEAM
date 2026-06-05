FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_PROJECT_ENVIRONMENT=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY shared/ ./shared/
COPY ResponseMerger/pyproject.toml ./ResponseMerger/

RUN uv sync --frozen --package response-merger --no-dev

COPY ResponseMerger/ ./ResponseMerger/

WORKDIR /app/ResponseMerger
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8022"]

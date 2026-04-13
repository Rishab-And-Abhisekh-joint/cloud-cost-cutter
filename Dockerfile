FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY cloud_cost_env /app/cloud_cost_env
COPY inference.py openenv.yaml /app/

RUN apt-get update \
        && apt-get install -y --no-install-recommends curl \
        && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip && pip install .

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

CMD ["sh", "-c", "python -m uvicorn cloud_cost_env.server.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${UVICORN_WORKERS:-1} --proxy-headers --forwarded-allow-ips='*' --log-level ${LOG_LEVEL:-info}"]

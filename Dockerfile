FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY cloud_cost_env /app/cloud_cost_env
COPY inference.py inference_llm.py openenv.yaml /app/

RUN python -m pip install --upgrade pip && pip install .

EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn cloud_cost_env.server.app:app --host 0.0.0.0 --port ${PORT:-8000}"]

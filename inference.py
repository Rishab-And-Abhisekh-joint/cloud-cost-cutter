from __future__ import annotations

import os

from openai import OpenAI

from cloud_cost_env.inference_llm import run


# Submission-required variables.
API_BASE_URL = os.getenv("API_BASE_URL", os.getenv("LLM_API_BASE_URL", "https://router.huggingface.co/v1"))
MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
HF_TOKEN = os.getenv("HF_TOKEN")
# Optional only when using from_docker_image() style local model serving.
LOCAL_IMAGE_NAME = os.getenv("LOCAL_IMAGE_NAME")


def build_client() -> OpenAI | None:
    api_key = HF_TOKEN or os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAI(base_url=API_BASE_URL, api_key=api_key)


def main() -> None:
    client = build_client()
    run(client_override=client, model_override=MODEL_NAME)


if __name__ == "__main__":
    main()

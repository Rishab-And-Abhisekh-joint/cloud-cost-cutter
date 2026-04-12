"""OpenEnv-compatible server entrypoint.

This wrapper re-exports the FastAPI app defined in cloud_cost_env so tools
that expect server/app.py can discover it.
"""

import uvicorn

from cloud_cost_env.server.app import app


def main() -> None:
	uvicorn.run("server.app:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
	main()

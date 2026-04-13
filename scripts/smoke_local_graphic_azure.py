import pathlib
import re
import tempfile

from fastapi.testclient import TestClient

from cloud_cost_env.server.app import app
from cloud_cost_env.server.web_tester import TESTER_HTML


def main() -> None:
    client = TestClient(app)

    web = client.get("/web")
    assert web.status_code == 200
    assert "Graphic Console" in web.text

    match = re.search(r"<script>([\s\S]*?)</script>", TESTER_HTML)
    assert match is not None
    js_path = pathlib.Path(tempfile.gettempdir()) / "local_graphic_web.js"
    js_path.write_text(match.group(1), encoding="utf-8")
    print(f"script_path={js_path}")

    dashboard = client.get("/azure/dashboard")
    assert dashboard.status_code == 200

    approval = client.get("/azure/approval")
    assert approval.status_code == 200
    token = approval.json()["token"]

    bad = client.post(
        "/azure/connect",
        json={
            "approved": False,
            "approval_token": token,
            "subscription_id": "00000000-0000-0000-0000-000000000000",
            "max_resources": 200,
        },
    )
    assert bad.status_code == 400
    print("local_api_checks_ok")


if __name__ == "__main__":
    main()

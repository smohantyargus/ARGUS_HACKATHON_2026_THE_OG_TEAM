import requests
from app.core.config import (AUTHENTIK_BASE_URL,
                             AUTHENTIK_API_TOKEN,
                             AUTHORIZATION_FLOW_UUID,
                             INVALIDATION_FLOW_UUID,
                             REDIRECT_URI,
                             AUTHENTIK_PROVIDER_URL,
                             AUTHENTIK_APPLICATION_URL)

HEADERS = {
    "Authorization": f"Bearer {AUTHENTIK_API_TOKEN}",
    "Content-Type": "application/json",
}


_AUTHENTIK_TIMEOUT = 10  # seconds


def create_application_for_user(user_id: int):

    provider_resp = requests.post(
        AUTHENTIK_PROVIDER_URL,
        headers=HEADERS,
        json={
            "name": f"user-{user_id}-provider",
            "client_type": "confidential",
            "authorization_flow": AUTHORIZATION_FLOW_UUID,
            "invalidation_flow": INVALIDATION_FLOW_UUID,
            "redirect_uris": [
                {
                    "matching_mode": "strict",
                    "url": REDIRECT_URI,
                }
            ],
        },
        timeout=_AUTHENTIK_TIMEOUT,
    )

    if not provider_resp.ok:
        raise Exception(provider_resp.text)

    provider = provider_resp.json()
    provider_pk = provider["pk"]

    bind_resp = requests.patch(
        f"{AUTHENTIK_PROVIDER_URL}{provider_pk}/",
        headers=HEADERS,
        json={
            "subject_mode": "user",
            "user": user_id,
        },
        timeout=_AUTHENTIK_TIMEOUT,
    )
    if not bind_resp.ok:
        raise Exception(bind_resp.text)

    app_resp = requests.post(
        AUTHENTIK_APPLICATION_URL,
        headers=HEADERS,
        json={
            "name": f"user-{user_id}-application",
            "slug": f"user-{user_id}-app",
            "provider": provider_pk,
        },
        timeout=_AUTHENTIK_TIMEOUT,
    )

    if not app_resp.ok:
        raise Exception(app_resp.text)

    application = app_resp.json()

    return {
        "application_name": application["name"],
        "application_slug": application["slug"],
        "client_id": provider["client_id"],
        "client_secret": provider["client_secret"],
    }


def get_user_client_credentials(user_id: int):

    resp = requests.get(
        f"{AUTHENTIK_BASE_URL}/api/v3/providers/oauth2/",
        headers=HEADERS,
        timeout=_AUTHENTIK_TIMEOUT,
    )

    if not resp.ok:
        raise Exception(resp.text)

    providers = resp.json()["results"]
    provider = next(
        (p for p in providers if p["name"] == f"user-{user_id}-provider"),
        None,
    )

    if not provider:
        raise Exception("No OAuth provider found for user")

    return {
        "client_id": provider["client_id"],
        "client_secret": provider["client_secret"],
        "provider_pk": provider["pk"],
    }



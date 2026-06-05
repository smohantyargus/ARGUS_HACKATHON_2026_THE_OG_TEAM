import os
from dotenv import load_dotenv

load_dotenv()

AUTHENTIK_BASE_URL=os.getenv("AUTHENTIK_BASE_URL")
AUTHENTIK_API_TOKEN=os.getenv("AUTHENTIK_API_TOKEN")
CLIENT_ID=os.getenv("CLIENT_ID")
CLIENT_SECRET=os.getenv("CLIENT_SECRET")
AUTHENTIK_TOKEN_URL=os.getenv("AUTHENTIK_TOKEN_URL")
AUTHENTIK_AUTHORIZE_URL=os.getenv("AUTHENTIK_AUTHORIZE_URL")
REDIRECT_URI=os.getenv("REDIRECT_URI")
AUTHORIZATION_FLOW_UUID=os.getenv("AUTHORIZATION_FLOW_UUID")
INVALIDATION_FLOW_UUID=os.getenv("INVALIDATION_FLOW_UUID")
URL_DATABASE=os.getenv("URL_DATABASE")
AUTHENTIK_JWKS_URL=os.getenv("AUTHENTIK_JWKS_URL")
AUTHENTIK_PROVIDER_URL=os.getenv("AUTHENTIK_PROVIDER_URL")
AUTHENTIK_APPLICATION_URL=os.getenv("AUTHENTIK_APPLICATION_URL")
AUTHENTIK_HOST_URL=os.getenv("AUTHENTIK_HOST_URL")
CLIENT_ID=os.getenv("CLIENT_ID", "")
CLIENT_SECRET=os.getenv("CLIENT_SECRET", "")
AUTHENTIK_REVOKE_URL=os.getenv(
    "AUTHENTIK_REVOKE_URL",
    (os.getenv("AUTHENTIK_TOKEN_URL", "")).replace("/token/", "/revoke/"),
)

# Admin registration key — set this in .env to enable admin self-registration.
# Leave unset (or empty) to disable admin registration entirely.
ADMIN_REGISTRATION_KEY=os.getenv("ADMIN_REGISTRATION_KEY", "")
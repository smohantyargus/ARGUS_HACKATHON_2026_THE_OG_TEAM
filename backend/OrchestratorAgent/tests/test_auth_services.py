from app.services.auth_service import register_user
from types import SimpleNamespace
from fastapi.responses import RedirectResponse
from app.services.auth_service import login_user, callback_service
from fastapi import HTTPException
from authentik_client.rest import ApiException

def test_register_user_success(mocker):
    
    fake_request = SimpleNamespace(
        username="testuser",
        email="test@test.com",
        full_name="Test User",
        password="password123",
    )

    fake_authentik_user = SimpleNamespace(
        pk=10,
        uuid="uuid-123",
        username="testuser",
    )

    mock_core_api = mocker.Mock()
    mock_core_api.core_users_create.return_value = fake_authentik_user
    mock_core_api.core_users_set_password_create.return_value = None

    mocker.patch(
        "app.services.auth_service.get_authentik_client",
        return_value=mocker.Mock(),
    )

    mocker.patch(
        "app.services.auth_service.CoreApi",
        return_value=mock_core_api,
    )

    mock_db = mocker.Mock()

    mock_create_app = mocker.patch(
        "app.services.auth_service.create_application_for_user",
        return_value=None,
    )

    result = register_user(fake_request, mock_db)

    mock_core_api.core_users_create.assert_called_once()
    mock_core_api.core_users_set_password_create.assert_called_once()

    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()
    mock_db.refresh.assert_called_once()

    mock_create_app.assert_called_once_with(10)

    assert result == {
        "message": "User registered successfully",
        "user_id": 10,
        "username": "testuser",
        "unique_id": "uuid-123",
    }

def test_register_user_authentik_failure(mocker):

    fake_request = SimpleNamespace(
        username="testuser",
        email="test@test.com",
        full_name="Test User",
        password="password123",
    )

    mock_core_api = mocker.Mock()
    mock_core_api.core_users_create.side_effect = ApiException(
        status=400,
        reason="User already exists"
    )

    mocker.patch(
        "app.services.auth_service.get_authentik_client",
        return_value=mocker.Mock()
    )

    mocker.patch(
        "app.services.auth_service.CoreApi",
        return_value=mock_core_api
    )

    mock_db = mocker.Mock()

    try:
        register_user(fake_request, mock_db)
        assert False  
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "User already exists" in exc.detail

def test_login_user_redirect(mocker):
 
    mocker.patch(
        "app.services.auth_service.CLIENT_ID",
        "mock-client-id"
    )
    mocker.patch(
        "app.services.auth_service.REDIRECT_URI",
        "http://localhost/callback"
    )
    mocker.patch(
        "app.services.auth_service.AUTHENTIK_AUTHORIZE_URL",
        "https://auth.example.com"
    )


    response = login_user()

    assert isinstance(response, RedirectResponse)

    location = response.headers["location"]

    assert location.startswith("https://auth.example.com")
    assert "client_id=mock-client-id" in location
    assert "response_type=code" in location

def test_callback_service_success(mocker):

    mocker.patch(
        "app.services.auth_service.AUTHENTIK_TOKEN_URL",
        "https://auth.example.com/token"
    )
    mocker.patch(
        "app.services.auth_service.CLIENT_ID",
        "mock-client-id"
    )
    mocker.patch(
        "app.services.auth_service.CLIENT_SECRET",
        "mock-client-secret"
    )
    mocker.patch(
        "app.services.auth_service.REDIRECT_URI",
        "http://test/callback"
    )

    fake_response = mocker.Mock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "access_token": "mock-access-token"
    }

    mock_post = mocker.patch(
        "app.services.auth_service.requests.post",
        return_value=fake_response
    )

    token = callback_service("fake-auth-code")

    assert token == "mock-access-token"
    mock_post.assert_called_once()

def test_callback_service_failure(mocker):

    fake_response = mocker.Mock()
    fake_response.status_code = 401
    fake_response.text = "Invalid authorization code"

    mocker.patch(
        "app.services.auth_service.requests.post",
        return_value=fake_response
    )

    try:
        callback_service("bad-auth-code")
        assert False  
    except HTTPException as exc:
        assert exc.status_code == 401
        assert "Invalid authorization code" in exc.detail

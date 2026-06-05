from fastapi.testclient import TestClient
from app.main import app
from fastapi.responses import RedirectResponse

client = TestClient(app)

def test_register_success(mocker):
    fake_response = {
        "message": "User registered successfully",
        "user_id": 1,
        "username": "testuser",
        "unique_id": "uuid-123",
    }

    mocker.patch(
        "app.api.routes.users.register_user",
        return_value=fake_response
    )

    response = client.post(
        "/auth/register",
        json={
            "username": "testuser",
            "full_name": "Test User",
            "email": "test@test.com",
            "password": "password123"
        }
    )

    assert response.status_code == 201
    assert response.json() == fake_response

def test_login_redirect(mocker):
    mock_url = "https://auth.example.com/authorize"

    mocker.patch(
        "app.api.routes.users.login_user",
        return_value=RedirectResponse(mock_url)
    )

    response = client.get("/auth/login", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert response.headers["location"] == mock_url

def test_callback(mocker):
    fake_response = "abcd123456"
    mocker.patch("app.api.routes.users.callback_service",
                 return_value= fake_response)
    response=client.get("/auth/callback?code=fake-code")

    assert response.status_code ==200
    assert response.json()==fake_response

def test_user_application(mocker):
    user_id=12
    fake_response={
        "application_name": "mock_applicaion",
        "application_slug":"mock_Application",
        "client_id": "mock12345678",
        "client_secret": "secret@12345678",
    }
    mocker.patch("app.api.routes.users.create_application_for_user",
                 return_value=fake_response)
    
    response=client.post(f"/auth/{user_id}/application")

    assert response.status_code==200
    assert response.json()==fake_response

def test_fetch_client_credentials(mocker):
    fake_user_id = 12
    fake_response={
        "client_id": "mock12345678",
        "client_secret": "secret@12345678",
        "provider_pk": "mock_pk",
    }

    mocker.patch(
        "app.api.routes.users.extract_user_from_token",
        return_value=fake_user_id
    )

    mocker.patch("app.api.routes.users.get_user_client_credentials",
                 return_value=fake_response)

    response=client.post("/auth/client-credentials",
                         json={
                             "access_token":"mock@123456789"
                         })
    assert response.status_code==200
    assert response.json()==fake_response

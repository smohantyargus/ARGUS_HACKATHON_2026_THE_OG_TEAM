from app.services.user_application_service import (create_application_for_user,
                                                   get_user_client_credentials)
import pytest

def test_create_application_for_user_success(mocker):

    user_id = 10

    fake_provider_response = mocker.Mock()
    fake_provider_response.ok = True
    fake_provider_response.json.return_value = {
        "pk": 123,
        "client_id": "mock-client-id",
        "client_secret": "mock-client-secret",
    }

    fake_bind_response = mocker.Mock()
    fake_bind_response.ok = True

    fake_app_response = mocker.Mock()
    fake_app_response.ok = True
    fake_app_response.json.return_value = {
        "name": "fake-application",
        "slug": "fake-application",
    }

    mocker.patch(
        "app.services.user_application_service.requests.post",
        side_effect=[fake_provider_response, fake_app_response],
    )

    mocker.patch(
        "app.services.user_application_service.requests.patch",
        return_value=fake_bind_response,
    )

    result = create_application_for_user(user_id)


    assert result == {
        "application_name": "fake-application",
        "application_slug": "fake-application",
        "client_id": "mock-client-id",
        "client_secret": "mock-client-secret",
    }

def test_create_application_provider_failure(mocker):

    fake_resp = mocker.Mock()
    fake_resp.ok = False
    fake_resp.text = "provider error"

    mocker.patch(
        "app.services.user_application_service.requests.post",
        return_value=fake_resp,
    )

    with pytest.raises(Exception, match="provider error"):
        create_application_for_user(10)

def test_create_application_creation_failure(mocker):

    provider_resp = mocker.Mock()
    provider_resp.ok = True
    provider_resp.json.return_value = {
        "pk": 123,
        "client_id": "mock-id",
        "client_secret": "mock-secret",
    }

    bind_resp = mocker.Mock()
    bind_resp.ok = True

    app_resp = mocker.Mock()
    app_resp.ok = False
    app_resp.text = "app create failed"

    mocker.patch(
        "app.services.user_application_service.requests.post",
        side_effect=[provider_resp, app_resp],
    )
    mocker.patch(
        "app.services.user_application_service.requests.patch",
        return_value=bind_resp,
    )

    with pytest.raises(Exception, match="app create failed"):
        create_application_for_user(10)

def test_get_user_client_credentials_success(mocker):

    fake_response = mocker.Mock()
    fake_response.ok = True
    fake_response.json.return_value = {
        "results": [
            {
                "name": "user-10-provider",
                "client_id": "mock-client-id",
                "client_secret": "mock-secret",
                "pk": 999,
            }
        ]
    }

    mocker.patch(
        "app.services.user_application_service.requests.get",
        return_value=fake_response,
    )

    result = get_user_client_credentials(10)

    assert result == {
        "client_id": "mock-client-id",
        "client_secret": "mock-secret",
        "provider_pk": 999,
    }

def test_get_user_client_credentials_request_failure(mocker):

    fake_resp = mocker.Mock()
    fake_resp.ok = False
    fake_resp.text = "request failed"

    mocker.patch(
        "app.services.user_application_service.requests.get",
        return_value=fake_resp,
    )

    with pytest.raises(Exception, match="request failed"):
        get_user_client_credentials(10)

def test_get_user_client_credentials_provider_not_found(mocker):

    fake_resp = mocker.Mock()
    fake_resp.ok = True
    fake_resp.json.return_value = {
        "results": [
            {"name": "some-other-provider"}
        ]
    }

    mocker.patch(
        "app.services.user_application_service.requests.get",
        return_value=fake_resp,
    )

    with pytest.raises(Exception, match="No OAuth provider found"):
        get_user_client_credentials(10)




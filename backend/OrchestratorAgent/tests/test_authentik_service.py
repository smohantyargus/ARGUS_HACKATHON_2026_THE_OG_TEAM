from types import SimpleNamespace
from app.services.authentik_service import extract_user_from_token
import pytest
from fastapi import HTTPException, status

def test_extract_user_from_token_success(mocker):
    mocker.patch(
        "app.services.authentik_service.requests.get",
        return_value=SimpleNamespace(
            json=lambda: {"keys": ["fake-jwk"]}
        )
    )

    mocker.patch(
        "app.services.authentik_service.jwt.decode",
        return_value={
            "preferred_username": "testuser"
        }
    )

    fake_user = SimpleNamespace(
        userId=42,
        username="testuser",
        isActive=True
    )

    mock_db = mocker.Mock()
    mock_db.query.return_value.filter_by.return_value.first.return_value = fake_user


    user_id = extract_user_from_token("fake-token", mock_db)


    assert user_id == 42

    mock_db.query.assert_called_once()



def test_extract_user_from_token_user_not_found(mocker):
    mocker.patch(
        "app.services.authentik_service.requests.get",
        return_value=SimpleNamespace(
            json=lambda: {"keys": ["fake-jwk"]}
        ),
    )

    mocker.patch(
        "app.services.authentik_service.jwt.decode",
        return_value={"preferred_username": "testuser"},
    )

    mock_db = mocker.Mock()
    mock_db.query.return_value.filter_by.return_value.first.return_value = None

    with pytest.raises(HTTPException) as exc:
        extract_user_from_token("fake-token", mock_db)

    assert exc.value.status_code == status.HTTP_404_NOT_FOUND
    assert exc.value.detail == "User not found in db"


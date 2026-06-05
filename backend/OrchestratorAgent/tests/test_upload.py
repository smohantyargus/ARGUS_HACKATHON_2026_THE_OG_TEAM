import pytest
import asyncio
from io import BytesIO
from fastapi import UploadFile, status
from starlette.datastructures import Headers
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.upload_service import upload_service

class MockEnum:
    def __init__(self, value):
        self.value = value

@patch("app.services.upload_service.JobType", [MockEnum("summarise"), MockEnum("transcribe")])
@patch("app.services.upload_service.Action", [MockEnum("soap"), MockEnum("prescription")])
class TestUploadService:

    class FakeKafkaMessage:
        def __init__(self, value):
            self.value = value

    class FakeKafkaConsumer:
        def __init__(self, messages):
            self.messages = messages
        async def __aiter__(self):
            for msg in self.messages:
                yield msg
        async def stop(self):
            pass

    class FakeKafkaProducer:
        async def send_and_wait(self, topic, value):
            pass
        async def stop(self):
            pass

    @pytest.mark.asyncio
    async def test_upload_service_summarise_success(self):
        fake_producer = self.FakeKafkaProducer()
        fake_consumer = self.FakeKafkaConsumer([
            self.FakeKafkaMessage({
                "job_id": "1234",
                "status_code": 200,
                "data": {"soap": "Test soap","prescription":"Test Prescription"}
            })
        ])

        with patch("app.services.upload_service.get_producer", AsyncMock(return_value=fake_producer)), \
             patch("app.services.upload_service.get_consumer", AsyncMock(return_value=fake_consumer)), \
             patch("asyncio.sleep", AsyncMock()):
            
            response = await upload_service(
                file=None,
                text="This is a transcript",
                job=["summarise"],
                action=["soap","prescription"], 
                model_name="whisperx",
                target_lang=None
            )

        assert response["data"]["soap"] == "Test soap"
        assert response["data"]["prescription"] == "Test Prescription"

    @pytest.mark.asyncio
    async def test_upload_service_transcribe_success(self):
        fake_producer = self.FakeKafkaProducer()
        fake_consumer = self.FakeKafkaConsumer([
            self.FakeKafkaMessage({
                "job_id": "5678",
                "status_code": 200,
                "data":  "Hello world"
            })
        ])

        upload_file = UploadFile(
            filename="audio.wav",
            file=BytesIO(b"fake audio data"),
            headers=Headers({"content-type": "audio/wav"})
        )

        with patch("app.services.upload_service.get_producer", AsyncMock(return_value=fake_producer)), \
             patch("app.services.upload_service.get_consumer", AsyncMock(return_value=fake_consumer)), \
             patch("pathlib.Path.mkdir"), \
             patch("builtins.open", MagicMock()), \
             patch("asyncio.sleep", AsyncMock()):
            
            response = await upload_service(
                file=upload_file,
                text="",
                job=["transcribe"],
                action=None,
                model_name="whisperx"
            )

        assert response["data"]== "Hello world"

    @pytest.mark.asyncio
    async def test_invalid_job_type(self):
        with patch("app.services.upload_service.get_producer", AsyncMock()), \
             patch("asyncio.sleep", AsyncMock()):
            
            response = await upload_service(
                file=None,
                text="some text",
                job=["invalid_job"],
                action=["soap"]
            )
            
        assert response["status_code"] == status.HTTP_400_BAD_REQUEST
        assert "is not a valid job type" in response["detail"]

    @pytest.mark.asyncio
    async def test_summarise_missing_text(self):
        with patch("app.services.upload_service.get_producer", AsyncMock()), \
             patch("asyncio.sleep", AsyncMock()):
            
            response = await upload_service(
                file=None,
                text="   ",
                job=["summarise"],
                action=["soap"]
            )

        assert response["status_code"] == 400
        assert "Specify text for summarisation" in response["detail"]

    @pytest.mark.asyncio
    async def test_transcribe_with_summarise_missing_action(self):
        """Tests the logic: if ('transcribe' in job) and (action is None and 'summarise' in job)"""
        upload_file = UploadFile(
            filename="audio.wav",
            file=BytesIO(b"fake audio"),
            headers=Headers({"content-type": "audio/wav"})
        )
        
        fake_consumer = self.FakeKafkaConsumer([]) 

        with patch("app.services.upload_service.get_producer", AsyncMock(return_value=self.FakeKafkaProducer())), \
            patch("app.services.upload_service.get_consumer", AsyncMock(return_value=fake_consumer)), \
            patch("app.services.upload_service.Path.mkdir"), \
            patch("builtins.open", MagicMock()), \
            patch("asyncio.sleep", AsyncMock()):
            
            try:
                response = await asyncio.wait_for(
                    upload_service(
                        file=upload_file,
                        text="",
                        job=["transcribe", "summarise"],
                        action=[],
                        model_name="whisperx"
                    ), 
                    timeout=2.0
                )
            except asyncio.TimeoutError:
                pytest.fail("Test hung! The service reached the Kafka consumer loop instead of returning a 400.")

        assert response["status_code"] == 400
        assert "Specify action soap or prescription for summary" in response["detail"]

    
    @pytest.mark.asyncio
    async def test_upload_service_combined_full_chain_success(self):
        """
        Scenario: Job is ["transcribe", "summarise"].
        The Orchestrator should save the file, send to 'audio.uploaded',
        and wait for 'task.completed'.
        """
        fake_producer = self.FakeKafkaProducer()
        
        final_task_completed_data = {
            "job_id": "chain-123",
            "status_code": 200,
            "data": {
                "soap": "Test soap",
                "prescription": "Test prescription"
            }
        }
        
        fake_consumer = self.FakeKafkaConsumer([self.FakeKafkaMessage(final_task_completed_data)])

        upload_file = UploadFile(
            filename="session_01.wav",
            file=BytesIO(b"fake audio bitstream"),
            headers=Headers({"content-type": "audio/wav"})
        )

        with patch("app.services.upload_service.get_producer", AsyncMock(return_value=fake_producer)), \
            patch("app.services.upload_service.get_consumer", AsyncMock(return_value=fake_consumer)), \
            patch("app.services.upload_service.Path.mkdir"), \
            patch("app.services.upload_service.Path.open", MagicMock()), \
            patch("builtins.open", MagicMock()), \
            patch("asyncio.sleep", AsyncMock()):
            
            response = await upload_service(
                file=upload_file,
                text="",
                job=["transcribe", "summarise"],
                action=["soap","prescription"], 
                model_name="whisperx",
                target_lang="en"
            )

        
        assert response is not None
        assert response["job_id"] == "chain-123"
        assert "soap" in response["data"]
        assert "prescription" in response["data"]
        assert response["data"]["soap"] == "Test soap"
        assert response["data"]["prescription"] == "Test prescription"
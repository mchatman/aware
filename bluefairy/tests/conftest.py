"""Test configuration and fixtures"""

import pytest
import numpy as np
from unittest.mock import AsyncMock, Mock
from typing import Tuple

from app.services.http import HTTPService
from app.mcp.client import MCPClient
from app.mcp.handlers.tools import ToolChangeHandler


@pytest.fixture
def mock_http_service():
    """Mock HTTPService for testing"""
    mock = Mock(spec=HTTPService)
    mock.send_request = AsyncMock()

    # Create async generator mock for audio streaming
    async def mock_audio_generator(*args, **kwargs):
        # Generate valid PCM data (16-bit integers)
        audio_samples = 1000  # Small sample size
        pcm_data = (np.random.randint(-32767, 32767, audio_samples, dtype=np.int16)).tobytes()
        yield pcm_data

    mock.send_request_audio = Mock(return_value=mock_audio_generator())
    return mock


@pytest.fixture
def mock_mcp_client():
    """Mock MCPClient for testing"""
    mock = Mock(spec=MCPClient)
    mock.get_tools = AsyncMock(return_value=[])
    mock.call_tool = AsyncMock(return_value="Tool response")
    return mock


@pytest.fixture
def mock_tool_change_handler():
    """Mock ToolChangeHandler for testing"""
    mock = Mock(spec=ToolChangeHandler)
    mock.cached_tools = []
    return mock


@pytest.fixture
def mock_audio_data() -> Tuple[int, np.ndarray]:
    """Mock audio data for testing"""
    sample_rate = 24000
    duration = 1.0  # 1 second
    samples = int(sample_rate * duration)
    audio_array = np.random.rand(1, samples).astype(np.float32)
    return (sample_rate, audio_array)


@pytest.fixture
def mock_openai_response():
    """Mock OpenAI API response"""
    return {
        "choices": [
            {
                "message": {
                    "content": "This is a test response from OpenAI"
                }
            }
        ]
    }


@pytest.fixture
def mock_openai_tool_response():
    """Mock OpenAI API response with tool calls"""
    return {
        "choices": [
            {
                "message": {
                    "content": "I'll help you with that.",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "get_weather",
                                "arguments": '{"location": "San Francisco"}'
                            }
                        }
                    ]
                }
            }
        ]
    }
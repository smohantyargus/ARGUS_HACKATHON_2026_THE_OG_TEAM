"""Phase 4 tests — agent_routed routing logic."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.pipeline_router as router
from app.services.pipeline_router import _EdgeInfo, _NodeInfo, _PipelineGraph


PIPELINE_ID = "pipeline-routed"
JOB_ID = "job-routed-1"
EDGE_ID = "edge-routed-1"


def _make_routed_graph(candidate_agents=None):
    node_router = _NodeInfo(
        node_id="n-router", node_key="RouterDecisionAgent",
        agent_name="RouterDecisionAgent",
        input_topic="router.input", output_topic="router.output",
    )
    node_b = _NodeInfo(
        node_id="n-b", node_key="AgentB",
        agent_name="AgentB",
        input_topic="agentb.input", output_topic="agentb.output",
    )
    node_c = _NodeInfo(
        node_id="n-c", node_key="AgentC",
        agent_name="AgentC",
        input_topic="agentc.input", output_topic="agentc.output",
    )
    edge = _EdgeInfo(
        edge_id=EDGE_ID,
        source_node_id="n-router",
        target_node_id="n-b",
        edge_type="agent_routed",
        is_parallel=False,
        wait_for_group=None,
        is_optional=False,
        candidate_agents=candidate_agents or ["AgentB", "AgentC"],
    )
    graph = _PipelineGraph(pipeline_id=PIPELINE_ID, pipeline_name="routed_pipeline")
    graph.nodes["n-router"] = node_router
    graph.nodes["n-b"] = node_b
    graph.nodes["n-c"] = node_c
    graph.edges.append(edge)
    return graph


@pytest.mark.asyncio
async def test_routes_to_correct_agent():
    """DecisionAgent output with next_agent=AgentB → message sent to AgentB's input topic."""
    router._graphs[PIPELINE_ID] = _make_routed_graph()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"next_agent": "AgentB", "payload": {"data": "x"}, "reason": "risk is low"}

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    mock_producer.send_and_wait.assert_called_once()
    assert mock_producer.send_and_wait.call_args[0][0] == "agentb.input"


@pytest.mark.asyncio
async def test_router_reason_propagated_in_message():
    """_router_reason field is present in the forwarded message."""
    router._graphs[PIPELINE_ID] = _make_routed_graph()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"next_agent": "AgentB", "payload": {}, "reason": "test reason here"}

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    sent_msg = mock_producer.send_and_wait.call_args[0][1]
    assert sent_msg["_router_reason"] == "test reason here"


@pytest.mark.asyncio
async def test_routed_by_field_in_message():
    """_routed_by contains the edge_id for traceability."""
    router._graphs[PIPELINE_ID] = _make_routed_graph()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"next_agent": "AgentB", "payload": {}}

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    sent_msg = mock_producer.send_and_wait.call_args[0][1]
    assert sent_msg["_routed_by"] == EDGE_ID


@pytest.mark.asyncio
async def test_invalid_agent_goes_to_dlq():
    """next_agent not in candidate_agents → publishes to agent.deadletter."""
    router._graphs[PIPELINE_ID] = _make_routed_graph(candidate_agents=["AgentB", "AgentC"])

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"next_agent": "MaliciousAgent", "payload": {}}

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    assert mock_producer.send_and_wait.call_args[0][0] == "agent.deadletter"


@pytest.mark.asyncio
async def test_missing_next_agent_goes_to_dlq():
    """Output missing 'next_agent' field → publishes to agent.deadletter."""
    router._graphs[PIPELINE_ID] = _make_routed_graph()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"payload": {"data": "x"}}  # no next_agent

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    assert mock_producer.send_and_wait.call_args[0][0] == "agent.deadletter"


@pytest.mark.asyncio
async def test_empty_candidate_agents_allows_any():
    """candidate_agents=[] means no guardrail — any valid agent name is accepted."""
    router._graphs[PIPELINE_ID] = _make_routed_graph(candidate_agents=[])

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"next_agent": "AgentC", "payload": {}}

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    # Should route to AgentC, not DLQ
    assert mock_producer.send_and_wait.call_args[0][0] == "agentc.input"


@pytest.mark.asyncio
async def test_node_not_found_goes_to_dlq():
    """next_agent valid candidate but no matching node in graph → DLQ."""
    router._graphs[PIPELINE_ID] = _make_routed_graph(candidate_agents=["AgentX"])

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    output = {"next_agent": "AgentX", "payload": {}}

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph(JOB_ID, PIPELINE_ID, "router.output.validated", output, {})

    # AgentX is in candidate_agents but not in graph.nodes
    assert mock_producer.send_and_wait.call_args[0][0] == "agent.deadletter"

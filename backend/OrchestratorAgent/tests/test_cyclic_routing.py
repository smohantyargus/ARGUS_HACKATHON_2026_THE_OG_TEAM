"""Phase 3 tests — cyclic_feedback routing logic."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from dataclasses import dataclass, field

import app.services.pipeline_router as router
from app.services.pipeline_router import _EdgeInfo, _NodeInfo, _PipelineGraph


PIPELINE_ID = "pipeline-cyclic"
JOB_ID = "job-cyclic-1"
EDGE_ID = "edge-cyclic-1"
NODE_A_ID = "node-a-id"


NODE_B_ID = "node-b-id"


def _make_cyclic_graph(max_iterations=3, break_field=None, break_value=None, loop_to="source"):
    node_a = _NodeInfo(
        node_id=NODE_A_ID, node_key="SpecialistA",
        agent_name="SpecialistA",
        input_topic="specialist_a.input", output_topic="specialist_a.output",
    )
    node_b = _NodeInfo(
        node_id=NODE_B_ID, node_key="CouncilHead",
        agent_name="CouncilHead",
        input_topic="council_head.input", output_topic="council_head.output",
    )
    edge = _EdgeInfo(
        edge_id=EDGE_ID,
        source_node_id=NODE_A_ID,
        target_node_id=NODE_B_ID,
        edge_type="cyclic_feedback",
        is_parallel=False,
        wait_for_group=None,
        is_optional=False,
        max_iterations=max_iterations,
        break_field=break_field,
        break_value=break_value,
        loop_to=loop_to,
    )
    graph = _PipelineGraph(pipeline_id=PIPELINE_ID, pipeline_name="cyclic_pipeline")
    graph.nodes[NODE_A_ID] = node_a
    graph.nodes[NODE_B_ID] = node_b
    graph.edges.append(edge)
    return graph


def _setup_graph(graph):
    router._graphs[PIPELINE_ID] = graph


@pytest.mark.asyncio
async def test_loops_back_and_increments_redis():
    """Router sends back to source node's input topic and increments Redis counter."""
    graph = _make_cyclic_graph(max_iterations=3)
    _setup_graph(graph)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=b"0")
    mock_redis.incr = AsyncMock()
    mock_redis.expire = AsyncMock()
    mock_redis.delete = AsyncMock()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_redis", AsyncMock(return_value=mock_redis)), \
         patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):

        await router.route_by_graph(
            JOB_ID, PIPELINE_ID, "specialist_a.output.validated",
            {"done": "false"}, {"job_id": JOB_ID},
        )

    # Should have sent to source node's input topic
    mock_producer.send_and_wait.assert_called_once()
    topic_sent = mock_producer.send_and_wait.call_args[0][0]
    assert topic_sent == "specialist_a.input"

    # Redis counter incremented
    mock_redis.incr.assert_called_once()
    mock_redis.expire.assert_called_once()


@pytest.mark.asyncio
async def test_iteration_field_injected_in_loop_message():
    """_iteration field is present in the looped-back message."""
    graph = _make_cyclic_graph(max_iterations=3)
    _setup_graph(graph)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=b"1")
    mock_redis.incr = AsyncMock()
    mock_redis.expire = AsyncMock()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_redis", AsyncMock(return_value=mock_redis)), \
         patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):

        await router.route_by_graph(
            JOB_ID, PIPELINE_ID, "specialist_a.output.validated",
            {"data": {"done": "false"}}, {"job_id": JOB_ID},
        )

    msg_sent = mock_producer.send_and_wait.call_args[0][1]
    assert "_iteration" in msg_sent
    assert msg_sent["_iteration"] == 2  # was at 1, now 2


@pytest.mark.asyncio
async def test_budget_exhaustion_sends_task_completed():
    """When max_iterations reached, router calls _send_completed instead of looping."""
    graph = _make_cyclic_graph(max_iterations=3)
    _setup_graph(graph)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=b"3")  # already at limit
    mock_redis.delete = AsyncMock()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_redis", AsyncMock(return_value=mock_redis)), \
         patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):

        await router.route_by_graph(
            JOB_ID, PIPELINE_ID, "specialist_a.output.validated",
            {"done": "false"}, {"job_id": JOB_ID},
        )

    # _send_completed creates its own producer; the outer producer should NOT have been used for looping
    # _send_completed publishes to task.completed
    calls = [c[0][0] for c in mock_producer.send_and_wait.call_args_list]
    assert "task.completed" in calls
    # Redis key deleted after budget exhaustion
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_break_condition_exits_early():
    """Agent returns break_field matching break_value — exits immediately without looping."""
    graph = _make_cyclic_graph(max_iterations=5, break_field="done", break_value="true")
    _setup_graph(graph)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=b"1")
    mock_redis.delete = AsyncMock()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_redis", AsyncMock(return_value=mock_redis)), \
         patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):

        await router.route_by_graph(
            JOB_ID, PIPELINE_ID, "specialist_a.output.validated",
            {"data": {"done": "true", "result": "converged"}}, {"job_id": JOB_ID},
        )

    calls = [c[0][0] for c in mock_producer.send_and_wait.call_args_list]
    assert "task.completed" in calls
    # Should NOT have looped back to specialist_a.input
    assert "specialist_a.input" not in calls
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_non_cyclic_edges_route_normally():
    """Sequential edges in the same graph still route to the target node unchanged."""
    node_a = _NodeInfo(node_id="na", node_key="A", agent_name="A", input_topic="a.in", output_topic="a.out")
    node_b = _NodeInfo(node_id="nb", node_key="B", agent_name="B", input_topic="b.in", output_topic="b.out")
    edge = _EdgeInfo(
        edge_id="e1", source_node_id="na", target_node_id="nb",
        edge_type="sequential", is_parallel=False, wait_for_group=None, is_optional=False,
    )
    graph = _PipelineGraph(pipeline_id="seq-pipe", pipeline_name="seq")
    graph.nodes["na"] = node_a
    graph.nodes["nb"] = node_b
    graph.edges.append(edge)
    router._graphs["seq-pipe"] = graph

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):
        await router.route_by_graph("job-seq", "seq-pipe", "a.out.validated", {"result": "ok"}, {})

    mock_producer.send_and_wait.assert_called_once()
    assert mock_producer.send_and_wait.call_args[0][0] == "b.in"


@pytest.mark.asyncio
async def test_loop_to_target_reenters_target_node():
    """loop_to='target' publishes to target node's input topic (council re-entry), not source."""
    graph = _make_cyclic_graph(max_iterations=3, loop_to="target")
    _setup_graph(graph)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=b"0")
    mock_redis.incr = AsyncMock()
    mock_redis.expire = AsyncMock()
    mock_redis.delete = AsyncMock()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_redis", AsyncMock(return_value=mock_redis)), \
         patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):

        await router.route_by_graph(
            JOB_ID, PIPELINE_ID, "specialist_a.output.validated",
            {"equilibrium_reached": "false"}, {"job_id": JOB_ID},
        )

    topic_sent = mock_producer.send_and_wait.call_args[0][0]
    # Must re-enter the council head (target node), not loop back to the source (aggregator)
    assert topic_sent == "council_head.input"
    assert topic_sent != "specialist_a.input"


@pytest.mark.asyncio
async def test_loop_to_source_default_unchanged():
    """loop_to='source' (default) still loops back to source node — existing behavior unchanged."""
    graph = _make_cyclic_graph(max_iterations=3, loop_to="source")
    _setup_graph(graph)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=b"0")
    mock_redis.incr = AsyncMock()
    mock_redis.expire = AsyncMock()

    mock_producer = AsyncMock()
    mock_producer.send_and_wait = AsyncMock()
    mock_producer.stop = AsyncMock()

    with patch("app.services.pipeline_router.get_redis", AsyncMock(return_value=mock_redis)), \
         patch("app.services.pipeline_router.get_producer", AsyncMock(return_value=mock_producer)):

        await router.route_by_graph(
            JOB_ID, PIPELINE_ID, "specialist_a.output.validated",
            {"done": "false"}, {"job_id": JOB_ID},
        )

    topic_sent = mock_producer.send_and_wait.call_args[0][0]
    assert topic_sent == "specialist_a.input"

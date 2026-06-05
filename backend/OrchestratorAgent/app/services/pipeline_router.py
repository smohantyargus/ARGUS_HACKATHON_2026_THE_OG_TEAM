"""
Pipeline Router — routes messages between agents based on pipeline graph definitions.

All routing is GRAPH mode: job.pipeline_definition_id → reads pipeline_definitions graph.
Supports fan-out (1 source → N targets) and fan-in (N sources → 1 target,
with Redis-based quorum tracking).

Fan-out:  one validated output topic → multiple target agent input topics (parallel branches).
Fan-in:   edges with the same wait_for_group → target node waits for all required sources.
          Optional edges (is_optional=True) are included in the merge but don't block quorum.
          Timeout: 30 s per fan-in group.
"""
from __future__ import annotations
import json
import logging
import os
from dataclasses import dataclass, field
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from app.core.app_database import AppSessionLocal
from app.services import job_service, webhook_service
from app.utils.kafka import get_producer
from app.utils.redis_client import get_redis

try:
    from civis_obs import (
        cycle_iteration_total,
        dynamic_route_total,
        dynamic_route_guardrail_violations_total,
    )
except ImportError:
    # Metrics are optional — router still functions without the shared lib installed
    cycle_iteration_total = None
    dynamic_route_total = None
    dynamic_route_guardrail_violations_total = None

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://localhost:8010")

# ── In-memory caches ──────────────────────────────────────────────────────────

_agent_cache: dict[str, dict] = {}       # agent_name -> {input_topic, output_topic}

# Graph caches
_graphs: dict[str, "_PipelineGraph"] = {}         # pipeline_id -> graph
_output_topic_index: dict[str, list[str]] = {}     # output_topic -> [pipeline_ids]
_all_validated_topics: set[str] = set()            # all *.validated topics to subscribe to
_pipeline_name_to_graph_id: dict[str, str] = {}   # pipeline_name -> pipeline_definition_id (UUID str)


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class _NodeInfo:
    node_id: str
    node_key: str
    agent_name: str
    input_topic: str
    output_topic: str
    config_override: dict = field(default_factory=dict)


@dataclass
class _EdgeInfo:
    edge_id: str
    source_node_id: str
    target_node_id: str
    edge_type: str          # sequential | parallel_fanout | merger_input | cyclic_feedback | agent_routed
    is_parallel: bool
    wait_for_group: str | None
    is_optional: bool
    # cyclic_feedback fields
    max_iterations: int = 3
    break_field: str | None = None
    break_value: str | None = None
    loop_to: str = "source"   # "source" = self-loop (default); "target" = loop to target node (council head)
    # agent_routed fields
    candidate_agents: list[str] = field(default_factory=list)


@dataclass
class _PipelineGraph:
    pipeline_id: str
    pipeline_name: str
    nodes: dict[str, _NodeInfo] = field(default_factory=dict)   # node_id -> NodeInfo
    edges: list[_EdgeInfo] = field(default_factory=list)

    def get_downstream(self, output_topic: str) -> list[tuple[_EdgeInfo, _NodeInfo]]:
        """
        Given a validated output topic, return (edge, target_node) pairs that should receive
        the next message. One source can map to multiple targets (fan-out).
        """
        source = next(
            (n for n in self.nodes.values() if n.output_topic == output_topic),
            None,
        )
        if not source:
            return []
        return [
            (edge, self.nodes[edge.target_node_id])
            for edge in self.edges
            if edge.source_node_id == source.node_id and edge.target_node_id in self.nodes
        ]

    def get_fanin_required(self, group_key: str) -> tuple[list[str], list[str]]:
        """
        For a wait_for_group, return (required_node_keys, optional_node_keys).
        Required = is_optional=False; Optional = is_optional=True.
        """
        required, optional = [], []
        for edge in self.edges:
            if edge.wait_for_group == group_key:
                src = self.nodes.get(edge.source_node_id)
                if src:
                    (optional if edge.is_optional else required).append(src.node_key)
        return required, optional


# ── Registry loading ──────────────────────────────────────────────────────────

async def _load_registry():
    """Load agent registry and graph pipeline definitions."""
    async with httpx.AsyncClient(timeout=10) as client:
        # Agents
        resp = await client.get(f"{CONFIG_SERVICE_URL}/internal/agents/")
        resp.raise_for_status()
        _agent_cache.clear()
        for agent in resp.json():
            _agent_cache[agent["name"]] = {
                "input_topic": agent["input_topic"],
                "output_topic": agent["output_topic"],
            }

        # Graph pipelines
        try:
            resp = await client.get(f"{CONFIG_SERVICE_URL}/pipelines/graph/")
            resp.raise_for_status()
            await _build_graph_cache(client, resp.json())
        except Exception as exc:
            logger.warning("Could not load graph pipelines: %s", exc)

    logger.info(
        "Registry: %d agents, %d graph pipelines, %d validated topics",
        len(_agent_cache), len(_graphs), len(_all_validated_topics),
    )


async def _build_graph_cache(client: httpx.AsyncClient, summaries: list[dict]):
    """Fetch full graph for each pipeline and build the in-memory index."""
    _graphs.clear()
    _output_topic_index.clear()
    _all_validated_topics.clear()
    _pipeline_name_to_graph_id.clear()

    for summary in summaries:
        if not summary.get("is_active"):
            continue
        pid = summary["id"]
        _pipeline_name_to_graph_id[summary["name"]] = pid
        try:
            resp = await client.get(f"{CONFIG_SERVICE_URL}/pipelines/graph/{pid}")
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("Could not fetch graph for pipeline %s: %s", pid, exc)
            continue

        graph = _PipelineGraph(pipeline_id=pid, pipeline_name=summary["name"])

        for n in data.get("nodes", []):
            agent_info = n.get("agent") or {}
            graph.nodes[n["id"]] = _NodeInfo(
                node_id=n["id"],
                node_key=n["node_key"],
                agent_name=agent_info.get("name", ""),
                input_topic=agent_info.get("input_topic", ""),
                output_topic=agent_info.get("output_topic", ""),
                config_override=n.get("config_override") or {},
            )

        for e in data.get("edges", []):
            graph.edges.append(_EdgeInfo(
                edge_id=e["id"],
                source_node_id=e["source_node_id"],
                target_node_id=e["target_node_id"],
                edge_type=e.get("edge_type", "sequential"),
                is_parallel=e.get("is_parallel", False),
                wait_for_group=e.get("wait_for_group"),
                is_optional=e.get("is_optional", False),
                max_iterations=e.get("max_iterations") or 3,
                break_field=e.get("break_field"),
                break_value=e.get("break_value"),
                loop_to=e.get("loop_to") or "source",
                candidate_agents=e.get("candidate_agents") or [],
            ))

        _graphs[pid] = graph

        # Build topic → pipeline index
        for node in graph.nodes.values():
            if node.output_topic:
                _output_topic_index.setdefault(node.output_topic, []).append(pid)
                # We subscribe to the validated version of each output topic
                _all_validated_topics.add(f"{node.output_topic}.validated")

    logger.info(
        "Graph cache built: %d pipelines, topics: %s",
        len(_graphs), sorted(_all_validated_topics),
    )


def get_all_validated_topics() -> set[str]:
    """Return all *.validated topics the router should subscribe to."""
    # Canonical validated topics (validator output = {agent_output_topic}.validated)
    base = {
        "stt.completed.validated",
        "nlp.completed.validated",
        "reasoning.completed.validated",
        # legacy names kept for in-flight jobs during rolling restarts
        "transcript.validated",
        "nlp.validated",
        "reasoning.validated",
    }
    return base | _all_validated_topics


def get_pipeline_definition_id(pipeline_name: str) -> str | None:
    """Return the UUID string of the graph PipelineDefinition matching pipeline_name, or None."""
    return _pipeline_name_to_graph_id.get(pipeline_name)


def get_pipeline_name_by_id(pipeline_id: str | UUID) -> str | None:
    """Return the name of the pipeline matching the given ID from the graph cache."""
    pid_str = str(pipeline_id)
    graph = _graphs.get(pid_str)
    return graph.pipeline_name if graph else None


def get_node_config(pipeline_id: str | UUID, node_key: str) -> dict:
    """
    Return the config_override dict for a given node within a pipeline.
    Used by ProcessingHelper to attach config to the first Kafka message.
    Returns empty dict if pipeline or node not found (graph not loaded yet).
    """
    pid_str = str(pipeline_id)
    graph = _graphs.get(pid_str)
    if not graph:
        return {}
    for node in graph.nodes.values():
        if node.node_key == node_key:
            return node.config_override or {}
    return {}


def get_entry_node(pipeline_id: str | UUID) -> _NodeInfo | None:
    """
    Return the entry node (no incoming edges) for a pipeline.
    Used by ProcessingHelper when first_step is determined by graph structure.
    """
    pid_str = str(pipeline_id)
    graph = _graphs.get(pid_str)
    if not graph:
        return None
    # cyclic_feedback edges loop back to an upstream node (e.g. the council head), so they
    # must NOT count as "incoming" when finding the entry node — otherwise a cyclic target
    # that is also the pipeline entry (the council head) would have no detectable entry.
    targets = {e.target_node_id for e in graph.edges if e.edge_type != "cyclic_feedback"}
    entries = [n for nid, n in graph.nodes.items() if nid not in targets]
    return entries[0] if entries else None


def get_pipeline_node_order(pipeline_id: str | UUID) -> list[str]:
    """Return node_keys in BFS order from entry node for step pre-creation."""
    pid_str = str(pipeline_id)
    graph = _graphs.get(pid_str)
    if not graph:
        return []
    # Exclude cyclic_feedback edges from entry detection AND BFS traversal so the loop-back
    # edge doesn't create a phantom incoming edge on the council head or an infinite walk.
    forward_edges = [e for e in graph.edges if e.edge_type != "cyclic_feedback"]
    targets = {e.target_node_id for e in forward_edges}
    entry_ids = [nid for nid in graph.nodes if nid not in targets]
    visited, order = set(), []
    queue = list(entry_ids)
    while queue:
        nid = queue.pop(0)
        if nid in visited:
            continue
        visited.add(nid)
        order.append(graph.nodes[nid].node_key)
        for edge in forward_edges:
            if edge.source_node_id == nid and edge.target_node_id not in visited:
                queue.append(edge.target_node_id)
    return order


def resolve_pipeline_name(input_type: str, actions: list[str]) -> tuple[str, list[str]]:
    """
    Map (input_type, actions) → (pipeline_name, step_names_list).
    Step names come from graph cache if loaded; else empty list (graph routing uses pipeline_definition_id).
    """
    if input_type == "audio":
        name = "audio_full" if actions else "audio_transcribe_only"
    else:
        name = "text_summarise"

    pid = _pipeline_name_to_graph_id.get(name)
    graph = _graphs.get(pid) if pid else None
    steps = [n.node_key for n in graph.nodes.values()] if graph else []
    return name, steps


# ── Fan-in quorum tracking (Redis) ────────────────────────────────────────────

_FANIN_TTL = 30  # seconds before incomplete fan-in expires


async def _fanin_contribute(
    job_id: str,
    group_key: str,
    source_node_key: str,
    payload: dict,
    required_keys: list[str],
) -> dict | None:
    """
    Record this source's contribution. Returns merged payload dict if quorum reached, else None.
    Non-blocking: always returns quickly. Expired fan-in groups are discarded.
    """
    r = await get_redis()
    hash_key = f"fanin:{job_id}:{group_key}"

    await r.hset(hash_key, source_node_key, json.dumps(payload, default=str))
    await r.expire(hash_key, _FANIN_TTL)

    collected_raw = await r.hgetall(hash_key)
    collected_keys = set(collected_raw.keys())

    required_set = set(required_keys)
    if not required_set.issubset(collected_keys):
        logger.debug(
            "fan-in job=%s group=%s waiting for %s (have %s)",
            job_id, group_key, required_set - collected_keys, collected_keys,
        )
        return None

    # Quorum reached
    merged = {k: json.loads(v) for k, v in collected_raw.items()}
    await r.delete(hash_key)
    logger.info("fan-in job=%s group=%s quorum reached (%d sources)", job_id, group_key, len(merged))
    return merged


# ── Graph routing ─────────────────────────────────────────────────────────────

async def route_by_graph(
    job_id: str,
    pipeline_definition_id: str,
    validated_topic: str,    # the *.validated topic the message arrived on
    step_output: dict,
    original_message: dict,
):
    """
    Route a validated agent output according to the pipeline graph.
    Handles fan-out (multiple edges) and fan-in (wait_for_group quorum).
    """
    # Strip .validated suffix to get the raw output topic
    raw_topic = validated_topic.removesuffix(".validated")

    graph = _graphs.get(pipeline_definition_id)
    if not graph:
        logger.warning(
            "No graph found for pipeline %s — falling back to task.completed",
            pipeline_definition_id,
        )
        await _send_completed(job_id, step_output)
        return

    targets = graph.get_downstream(raw_topic)

    if not targets:
        # This was the terminal node — pipeline complete
        await _send_completed(job_id, step_output)
        logger.info("Job %s pipeline '%s' complete (terminal node)", job_id, graph.pipeline_name)
        return

    producer = None
    try:
        producer = await get_producer()

        # Group targets by wait_for_group to handle fan-in
        fanin_groups: dict[str, list[tuple[_EdgeInfo, _NodeInfo]]] = {}
        direct_targets: list[tuple[_EdgeInfo, _NodeInfo]] = []

        for edge, node in targets:
            if edge.wait_for_group:
                fanin_groups.setdefault(edge.wait_for_group, []).append((edge, node))
            else:
                direct_targets.append((edge, node))

        # Fan-out: direct targets (no quorum needed)
        for edge, node in direct_targets:
            if edge.edge_type == "cyclic_feedback":
                r = await get_redis()
                cycle_key = f"cyclic:{job_id}:{edge.edge_id}"

                # Check break condition first (agent signalled done)
                if edge.break_field:
                    actual = str(
                        (step_output.get("data", step_output) if isinstance(step_output, dict) else {})
                        .get(edge.break_field, "")
                    )
                    if actual == edge.break_value:
                        logger.info(
                            "Job %s cyclic edge %s break condition met (%s=%s) — exiting loop",
                            job_id, edge.edge_id, edge.break_field, edge.break_value,
                        )
                        await _send_completed(job_id, step_output)
                        await r.delete(cycle_key)
                        continue

                iteration = int(await r.get(cycle_key) or 0)
                if iteration >= edge.max_iterations:
                    logger.warning(
                        "Job %s cyclic edge %s hit max_iterations=%d — forcing exit",
                        job_id, edge.edge_id, edge.max_iterations,
                    )
                    await _send_completed(job_id, step_output)
                    await r.delete(cycle_key)
                    continue

                await r.incr(cycle_key)
                await r.expire(cycle_key, 600)

                # loop_to="target": re-enter target node (council head re-runs whole fan-out)
                # loop_to="source": self-loop back to the completing node (default)
                loop_node_id = edge.target_node_id if edge.loop_to == "target" else edge.source_node_id
                loop_node = graph.nodes.get(loop_node_id)
                if not loop_node:
                    logger.error("Job %s cyclic edge %s loop node not found (loop_to=%s)", job_id, edge.edge_id, edge.loop_to)
                    continue
                loop_msg = _build_forward_msg(job_id, loop_node, step_output, original_message)
                loop_msg["_iteration"] = iteration + 1
                loop_msg["_cycle_edge_id"] = edge.edge_id
                # Feed the aggregator's candidate policy + unresolved conflicts back into the
                # council head as {{current_policy}} / {{peer_feedback}} / {{iteration}} so the
                # next round re-evaluates against the amended proposal (real negotiation).
                if isinstance(step_output, dict):
                    candidate = step_output.get("policy") or step_output.get("rationale")
                    if candidate:
                        loop_msg["current_policy"] = candidate if isinstance(candidate, str) else json.dumps(candidate)
                    conflicts = step_output.get("_conflicts")
                    if conflicts:
                        loop_msg["peer_feedback"] = json.dumps(conflicts, default=str)
                loop_msg["iteration"] = iteration + 1
                await producer.send_and_wait(loop_node.input_topic, loop_msg)
                logger.info(
                    "Job %s looping back to %s (loop_to=%s, iteration %d/%d)",
                    job_id, loop_node.node_key, edge.loop_to, iteration + 1, edge.max_iterations,
                )
                if cycle_iteration_total:
                    cycle_iteration_total.labels(pipeline_id=pipeline_definition_id, edge_id=edge.edge_id).inc()

            elif edge.edge_type == "agent_routed":
                output_data = step_output.get("data", step_output) if isinstance(step_output, dict) else {}
                next_agent_name = output_data.get("next_agent")
                payload = output_data.get("payload", output_data)

                if not next_agent_name:
                    logger.error(
                        "Job %s agent_routed edge %s: output missing 'next_agent' — DLQ",
                        job_id, edge.edge_id,
                    )
                    await _route_to_dlq(producer, job_id, edge.edge_id, "missing_next_agent", step_output, original_message)
                    continue

                if edge.candidate_agents and next_agent_name not in edge.candidate_agents:
                    logger.error(
                        "Job %s agent_routed: '%s' not in candidates %s — DLQ",
                        job_id, next_agent_name, edge.candidate_agents,
                    )
                    if dynamic_route_guardrail_violations_total:
                        dynamic_route_guardrail_violations_total.labels(pipeline_id=pipeline_definition_id).inc()
                    await _route_to_dlq(producer, job_id, edge.edge_id, "invalid_next_agent", step_output, original_message)
                    continue

                target_node = next(
                    (n for n in graph.nodes.values() if n.agent_name == next_agent_name),
                    None,
                )
                if not target_node:
                    logger.error(
                        "Job %s agent_routed: no node found for agent '%s' — DLQ",
                        job_id, next_agent_name,
                    )
                    await _route_to_dlq(producer, job_id, edge.edge_id, "no_node_for_agent", step_output, original_message)
                    continue

                routed_msg = {
                    "job_id": job_id,
                    "step_name": target_node.node_key,
                    "payload": payload,
                    "config": target_node.config_override or {},
                    "_routed_by": edge.edge_id,
                    "_router_reason": output_data.get("reason", ""),
                }
                await producer.send_and_wait(target_node.input_topic, routed_msg)
                logger.info(
                    "Job %s agent_routed → '%s' (topic: %s, reason: %s)",
                    job_id, next_agent_name, target_node.input_topic,
                    str(output_data.get("reason", ""))[:80],
                )
                if dynamic_route_total:
                    dynamic_route_total.labels(pipeline_id=pipeline_definition_id, chosen_agent=next_agent_name).inc()

            else:
                msg = _build_forward_msg(job_id, node, step_output, original_message)
                await producer.send_and_wait(node.input_topic, msg)
                logger.info(
                    "Job %s [%s] → %s (topic: %s)",
                    job_id, edge.edge_type, node.node_key, node.input_topic,
                )

        # Fan-in groups: contribute to quorum
        src_node = next(
            (n for n in graph.nodes.values() if n.output_topic == raw_topic),
            None,
        )
        src_key = src_node.node_key if src_node else raw_topic

        for group_key, group_edges in fanin_groups.items():
            required_keys, _ = graph.get_fanin_required(group_key)
            merged = await _fanin_contribute(
                job_id, group_key, src_key, step_output, required_keys,
            )
            if merged is not None:
                # All required sources arrived — forward to target node(s)
                # All edges in this group point to the same target
                _, target_node = group_edges[0]
                agg_msg = _build_fanin_msg(job_id, target_node, merged, original_message)
                await producer.send_and_wait(target_node.input_topic, agg_msg)
                logger.info(
                    "Job %s fan-in group=%s complete → %s (topic: %s)",
                    job_id, group_key, target_node.node_key, target_node.input_topic,
                )

    finally:
        if producer:
            await producer.stop()


def get_agent_input_topic(agent_name: str) -> str | None:
    info = _agent_cache.get(agent_name)
    return info["input_topic"] if info else None


def _fallback_topic(step_name: str) -> str | None:
    mapping = {
        "preprocess": "audio.uploaded",
        "transcribe": "audio.preprocessed",
        "summarise": "transcript.generated",
    }
    return mapping.get(step_name)


# ── Unified entry points ───────────────────────────────────────────────────────

async def route_step_completion(
    job_id: str,
    completed_step: str,
    step_output: dict,
    original_message: dict,
):
    """
    Main routing entry point. Called by orchestrator's _route_steps consumer.
    All jobs route via graph mode (pipeline_definition_id required).
    """
    db: Session = AppSessionLocal()
    try:
        job_service.complete_step(db, job_id, completed_step, step_output)
        job = job_service.get_job(db, job_id)
        if not job:
            logger.error("Job %s not found during routing", job_id)
            return

        if not job.pipeline_definition_id:
            logger.error("Job %s has no pipeline_definition_id — cannot route", job_id)
            job_service.fail_job(db, job_id, "No pipeline definition attached to job")
            db.close()
            return

        validated_topic = original_message.get("_source_topic", "")
        db.close()
        await route_by_graph(
            job_id,
            str(job.pipeline_definition_id),
            validated_topic,
            step_output,
            original_message,
        )

    except Exception:
        logger.exception("Pipeline routing failed for job %s step %s", job_id, completed_step)
        try:
            db.close()
        except Exception:
            pass


async def handle_validation_failure(
    job_id: str,
    step_name: str,
    rule_violated: str,
    error_detail: str,
    original_message: dict,
):
    """Retry agent or fail job when a validator rejects output."""
    db: Session = AppSessionLocal()
    producer = None
    try:
        job = job_service.get_job(db, job_id)
        if not job:
            logger.error("handle_validation_failure: job %s not found", job_id)
            return

        # Resolve max_retries from graph or legacy pipeline config
        max_retries = 2
        if job.pipeline_definition_id:
            # In graph mode, find the node for this step and get its max_retries
            graph = _graphs.get(str(job.pipeline_definition_id))
            if graph:
                node = next(
                    (n for n in graph.nodes.values() if n.node_key == step_name),
                    None,
                )
                # max_retries is stored on the Job's pipeline config_override; default 2
                max_retries = 2  # TODO: read from PipelineNode.max_retries if stored in job context
        else:
            if job.pipeline:
                for step in job.pipeline:
                    if isinstance(step, dict) and step.get("name") == step_name:
                        max_retries = step.get("max_retries", 2)
                        break

        new_retry_count = job_service.increment_step_retry(db, job_id, step_name)

        if new_retry_count <= max_retries:
            agent_name = job_service._agent_for_step(step_name)
            input_topic = get_agent_input_topic(agent_name) or _fallback_topic(step_name)

            if not input_topic and job.pipeline_definition_id:
                # Find input topic from graph
                graph = _graphs.get(str(job.pipeline_definition_id))
                if graph:
                    node = next(
                        (n for n in graph.nodes.values() if n.node_key == step_name),
                        None,
                    )
                    if node:
                        input_topic = node.input_topic

            if not input_topic:
                logger.error("No input topic for step '%s' — cannot retry job %s", step_name, job_id)
                job_service.fail_job(db, job_id, f"Validation failed, no retry topic for '{step_name}'")
                return

            feedback_msg = {
                **original_message,
                "feedback": (
                    f"Your previous output failed validation: "
                    f"[{rule_violated}] {error_detail}. "
                    "Please correct and resubmit."
                ),
                "retry_count": new_retry_count,
            }
            producer = await get_producer()
            await producer.send_and_wait(input_topic, feedback_msg)
            logger.info(
                "Job %s step '%s' validation failed (%d/%d) — retrying",
                job_id, step_name, new_retry_count, max_retries,
            )
        else:
            on_failure = "fail_job"
            if job.pipeline:
                for step in job.pipeline:
                    if isinstance(step, dict) and step.get("name") == step_name:
                        on_failure = step.get("on_failure", "fail_job")
                        break

            if on_failure == "skip_step":
                logger.warning(
                    "Job %s step '%s' skipped after %d validation failures",
                    job_id, step_name, max_retries,
                )
                job_service.fail_step(db, job_id, step_name, f"Skipped after {max_retries} validation failures")
            else:
                err = f"Validation failed after {max_retries} retries [{rule_violated}]: {error_detail}"
                job_service.fail_step(db, job_id, step_name, err)
                job_service.fail_job(db, job_id, err)
                logger.error("Job %s failed: step '%s' exhausted retries", job_id, step_name)
                await webhook_service.dispatch_webhooks(
                    db, "job.failed",
                    {"job_id": job_id, "error": err, "step": step_name},
                    tenant_id=job.tenant_id,
                )
                # Publish to DLQ for audit trail and potential replay
                try:
                    if producer is None:
                        producer = await get_producer()
                    dlq_msg = {
                        "job_id": job_id,
                        "step_name": step_name,
                        "topic": original_message.get("_source_topic", "unknown"),
                        "error": err,
                        "original_message": original_message,
                    }
                    await producer.send_and_wait("agent.deadletter", dlq_msg)
                    logger.info("Job %s published to agent.deadletter (step=%s)", job_id, step_name)
                except Exception as dlq_exc:
                    logger.error("Failed to publish job %s to DLQ: %s", job_id, dlq_exc)

    except Exception:
        logger.exception("Error handling validation failure for job %s step %s", job_id, step_name)
    finally:
        db.close()
        if producer:
            await producer.stop()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _send_completed(job_id: str, data: dict):
    producer = await get_producer()
    try:
        await producer.send_and_wait("task.completed", {"job_id": job_id, "data": data, "status_code": 200})
    finally:
        await producer.stop()


async def _route_to_dlq(producer, job_id: str, edge_id: str, reason: str, step_output: dict, original_message: dict):
    """Publish a routing failure to the dead-letter queue using an existing producer."""
    await producer.send_and_wait("agent.deadletter", {
        "job_id": job_id,
        "edge_id": edge_id,
        "error": reason,
        "step_name": "agent_routed",
        "original_message": original_message,
    })


_AUDIO_INPUT_TOPICS = {"audio.uploaded", "audio.preprocessed"}

# Scenario context that must survive every hop (fan-out, fan-in, cyclic re-entry) so
# config-driven negotiation agents keep their scenario/region/candidate-policy across rounds.
# Agents that echo these top-level fields (GenericAgent v2) let the router thread them forward.
_CONTEXT_KEYS = ("scenario", "region", "current_policy", "peer_feedback", "iteration")


def _carry_context(msg: dict, orig: dict) -> dict:
    """Overlay non-empty scenario-context fields from `orig` onto a forward message."""
    for k in _CONTEXT_KEYS:
        v = orig.get(k)
        if v not in (None, "") and k not in msg:
            msg[k] = v
    return msg


def _build_forward_msg(job_id: str, node: _NodeInfo, prev_output: dict, orig: dict) -> dict:
    """Build the Kafka message for forwarding to the next agent's input topic.
    Per-step behavior is driven by `node.config_override`; no `action` passthrough.

    Audio agents (consuming audio.uploaded / audio.preprocessed) require
    file_path, model_name, target_lang at the top level. We dispatch on
    `node.input_topic` (stable contract) rather than `node.node_key` so
    renaming a node in the pipeline UI does not silently break routing.
    """
    if node.input_topic in _AUDIO_INPUT_TOPICS:
        prev_fp = prev_output.get("file_path") if isinstance(prev_output, dict) else None
        return {
            "job_id": job_id,
            "step_name": node.node_key,
            "file_path": prev_fp or orig.get("file_path", ""),
            "model_name": orig.get("model_name", ""),
            "target_lang": orig.get("target_lang", "en"),
            "config": node.config_override or {},
        }
    # prev_output may be a plain string (e.g. raw transcript from STT)
    if isinstance(prev_output, str):
        transcript = orig.get("transcript") or prev_output
    else:
        transcript = (
            orig.get("transcript")
            or prev_output.get("transcript")
            or prev_output.get("output")
            or ""
        )
    return _carry_context({
        "job_id": job_id,
        "step_name": node.node_key,
        "transcript": transcript,
        "payload": prev_output,
        "config": node.config_override or {},
    }, orig)


def _build_fanin_msg(job_id: str, node: _NodeInfo, merged: dict, orig: dict) -> dict:
    """Build the aggregated message for a fan-in target node."""
    return _carry_context({
        "job_id": job_id,
        "step_name": node.node_key,
        "transcript": orig.get("transcript", ""),
        "aggregated": merged,   # dict of {source_node_key: payload}
        "config": node.config_override or {},
    }, orig)



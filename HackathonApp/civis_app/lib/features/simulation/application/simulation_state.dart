import 'dart:math';
import '../domain/job_step.dart';
import '../domain/final_policy.dart';

enum SimPhase { idle, triggering, running, completed, failed }

class SimulationState {
  final SimPhase phase;
  final String? jobId;
  final String jobStatus;
  final List<JobStep> steps;
  final FinalPolicy? finalPolicy;
  final String? error;

  const SimulationState({
    this.phase = SimPhase.idle,
    this.jobId,
    this.jobStatus = 'pending',
    this.steps = const [],
    this.finalPolicy,
    this.error,
  });

  SimulationState copyWith({
    SimPhase? phase,
    String? jobId,
    String? jobStatus,
    List<JobStep>? steps,
    FinalPolicy? finalPolicy,
    String? error,
    bool clearError = false,
    bool clearFinalPolicy = false,
  }) =>
      SimulationState(
        phase: phase ?? this.phase,
        jobId: jobId ?? this.jobId,
        jobStatus: jobStatus ?? this.jobStatus,
        steps: steps ?? this.steps,
        finalPolicy: clearFinalPolicy ? null : finalPolicy ?? this.finalPolicy,
        error: clearError ? null : error ?? this.error,
      );

  Map<int, List<JobStep>> get byRound {
    final map = <int, List<JobStep>>{};
    for (final step in steps) {
      final r = step.round;
      map.putIfAbsent(r, () => []).add(step);
    }
    return Map.fromEntries(
      map.entries.toList()..sort((a, b) => a.key.compareTo(b.key)),
    );
  }

  int get currentRound {
    final rounds = byRound.keys;
    return rounds.isEmpty ? 1 : rounds.reduce(max);
  }
}

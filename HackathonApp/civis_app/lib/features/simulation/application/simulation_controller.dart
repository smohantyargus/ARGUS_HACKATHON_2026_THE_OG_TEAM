import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/simulation_repository.dart';
import '../domain/final_policy.dart';
import '../../../features/pipeline/application/pipeline_provider.dart';
import 'simulation_state.dart';

class SimulationController extends AsyncNotifier<SimulationState> {
  Timer? _timer;
  bool _tickInFlight = false;

  @override
  Future<SimulationState> build() async {
    ref.onDispose(() {
      _timer?.cancel();
    });
    return const SimulationState();
  }

  Future<void> trigger(String scenario) async {
    _timer?.cancel();
    _tickInFlight = false;
    state = AsyncData(const SimulationState(phase: SimPhase.triggering));

    try {
      final pid = await ref.read(epidemicPipelineIdProvider.future);
      final repo = ref.read(simulationRepositoryProvider);
      final jobId = await repo.triggerAsync(scenario, pid);

      state = AsyncData(SimulationState(
        phase: SimPhase.running,
        jobId: jobId,
        jobStatus: 'pending',
      ));

      _timer = Timer.periodic(
        const Duration(milliseconds: 1500),
        (_) => _tick(),
      );
    } catch (e) {
      state = AsyncData(SimulationState(
        phase: SimPhase.failed,
        error: e.toString().replaceFirst('ApiException: ', ''),
      ));
    }
  }

  Future<void> _tick() async {
    if (_tickInFlight) return;
    final current = state.valueOrNull;
    final jobId = current?.jobId;
    if (jobId == null) return;

    _tickInFlight = true;
    try {
      final repo = ref.read(simulationRepositoryProvider);
      final results = await Future.wait([
        repo.getJob(jobId),
        repo.getSteps(jobId),
      ]);

      final job = results[0] as dynamic;
      final steps = results[1] as dynamic;

      if (job.isTerminal) {
        _timer?.cancel();
        _timer = null;

        if (job.status == 'completed' && job.result != null) {
          final policy = FinalPolicy.fromResult(job.result!);
          state = AsyncData(SimulationState(
            phase: SimPhase.completed,
            jobId: jobId,
            jobStatus: job.status,
            steps: steps,
            finalPolicy: policy,
          ));
        } else {
          state = AsyncData(SimulationState(
            phase: SimPhase.failed,
            jobId: jobId,
            jobStatus: job.status,
            steps: steps,
            error: job.error ?? 'Job ${job.status}',
          ));
        }
      } else {
        state = AsyncData((current ?? const SimulationState()).copyWith(
          jobStatus: job.status,
          steps: steps,
        ));
      }
    } catch (_) {
      // swallow tick errors silently; next tick will retry
    } finally {
      _tickInFlight = false;
    }
  }

  void reset() {
    _timer?.cancel();
    _timer = null;
    _tickInFlight = false;
    state = const AsyncData(SimulationState());
  }
}

final simulationControllerProvider =
    AsyncNotifierProvider<SimulationController, SimulationState>(
  SimulationController.new,
);

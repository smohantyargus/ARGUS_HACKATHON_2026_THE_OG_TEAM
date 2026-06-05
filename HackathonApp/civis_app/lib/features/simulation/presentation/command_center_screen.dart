import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/application/auth_controller.dart';
import '../application/simulation_controller.dart';
import '../application/simulation_state.dart';
import '../../../shared/widgets/status_dot.dart';
import 'widgets/scenario_input.dart';
import 'widgets/round_section.dart';
import 'widgets/equilibrium_banner.dart';
import 'widgets/final_policy_card.dart';

class CommandCenterScreen extends ConsumerStatefulWidget {
  const CommandCenterScreen({super.key});

  @override
  ConsumerState<CommandCenterScreen> createState() =>
      _CommandCenterScreenState();
}

class _CommandCenterScreenState extends ConsumerState<CommandCenterScreen> {
  final _scenarioCtrl = TextEditingController();

  @override
  void dispose() {
    _scenarioCtrl.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    final text = _scenarioCtrl.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a scenario first')),
      );
      return;
    }
    await ref.read(simulationControllerProvider.notifier).trigger(text);
  }

  void _reset() {
    ref.read(simulationControllerProvider.notifier).reset();
  }

  @override
  Widget build(BuildContext context) {
    final simAsync = ref.watch(simulationControllerProvider);

    return simAsync.when(
      loading: () => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => Scaffold(
        body: Center(child: Text('Error: $e')),
      ),
      data: (sim) => _buildScaffold(sim),
    );
  }

  Scaffold _buildScaffold(SimulationState sim) {
    final isRunning = sim.phase == SimPhase.running ||
        sim.phase == SimPhase.triggering;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text('CIVIS · Epidemic Council'),
            const SizedBox(width: 10),
            StatusDot(active: isRunning),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            onSelected: (val) {
              if (val == 'logout') {
                ref.read(authControllerProvider.notifier).logout();
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'logout', child: Text('Logout')),
            ],
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Scenario input
          ScenarioInput(
            controller: _scenarioCtrl,
            isRunning: isRunning,
            onRun: _run,
          ),

          // Error banner
          if (sim.phase == SimPhase.failed && sim.error != null)
            Container(
              margin: const EdgeInsets.only(top: 16),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.red.shade800),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, color: Colors.redAccent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(sim.error!,
                        style: const TextStyle(color: Colors.redAccent)),
                  ),
                ],
              ),
            ),

          // Round sections
          if (sim.steps.isNotEmpty) ...[
            const SizedBox(height: 16),
            ...sim.byRound.entries.map(
              (e) => RoundSection(round: e.key, steps: e.value),
            ),
          ] else if (isRunning) ...[
            const SizedBox(height: 24),
            const Center(
              child: Text(
                'Waiting for agents to respond…',
                style: TextStyle(color: Colors.white38),
              ),
            ),
          ],

          // Completed results
          if (sim.phase == SimPhase.completed && sim.finalPolicy != null) ...[
            const SizedBox(height: 16),
            EquilibriumBanner(
              equilibriumReached: sim.finalPolicy!.equilibriumReached,
              roundCount: sim.currentRound,
            ),
            const SizedBox(height: 12),
            FinalPolicyCard(policy: sim.finalPolicy!),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _reset,
                icon: const Icon(Icons.refresh),
                label: const Text('Reset'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white70,
                  side: const BorderSide(color: Colors.white24),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],

          if (sim.phase == SimPhase.failed) ...[
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _reset,
                icon: const Icon(Icons.refresh),
                label: const Text('Reset'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white70,
                  side: const BorderSide(color: Colors.white24),
                ),
              ),
            ),
          ],

          const SizedBox(height: 40),
        ],
      ),
    );
  }
}

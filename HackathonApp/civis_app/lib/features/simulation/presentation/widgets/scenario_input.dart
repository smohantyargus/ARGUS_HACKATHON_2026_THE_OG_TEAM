import 'package:flutter/material.dart';

const _kSampleScenario =
    'A new influenza variant with an estimated R0 of 2.5 has been detected '
    'spreading through public transit hubs in a city of 5 million people.';

class ScenarioInput extends StatelessWidget {
  final TextEditingController controller;
  final bool isRunning;
  final VoidCallback onRun;

  const ScenarioInput({
    super.key,
    required this.controller,
    required this.isRunning,
    required this.onRun,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: controller,
          maxLines: 4,
          enabled: !isRunning,
          decoration: const InputDecoration(
            hintText: 'Describe the epidemic scenario…',
            hintStyle: TextStyle(color: Colors.white24),
            alignLabelWithHint: true,
          ),
          style: const TextStyle(fontSize: 14, height: 1.5),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            ActionChip(
              label: const Text('Load sample R0=2.5'),
              avatar: const Icon(Icons.science_outlined, size: 14),
              backgroundColor: Colors.white.withValues(alpha: 0.07),
              labelStyle:
                  const TextStyle(color: Colors.white70, fontSize: 12),
              onPressed: isRunning
                  ? null
                  : () => controller.text = _kSampleScenario,
            ),
          ],
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: isRunning ? null : onRun,
            icon: isRunning
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child:
                        CircularProgressIndicator(strokeWidth: 2, color: Colors.black54),
                  )
                : const Icon(Icons.play_arrow_rounded),
            label: Text(isRunning ? 'Running…' : 'Run Simulation'),
          ),
        ),
      ],
    );
  }
}

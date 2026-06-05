import 'package:flutter/material.dart';
import '../../domain/job_step.dart';
import 'agent_card.dart';

class RoundSection extends StatelessWidget {
  final int round;
  final List<JobStep> steps;

  const RoundSection({super.key, required this.round, required this.steps});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              Expanded(child: Divider(color: Colors.white12)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  'Round $round',
                  style: const TextStyle(
                    color: Colors.white54,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                    fontSize: 12,
                  ),
                ),
              ),
              Expanded(child: Divider(color: Colors.white12)),
            ],
          ),
        ),
        ...steps.map((s) => AgentCard(step: s)),
      ],
    );
  }
}

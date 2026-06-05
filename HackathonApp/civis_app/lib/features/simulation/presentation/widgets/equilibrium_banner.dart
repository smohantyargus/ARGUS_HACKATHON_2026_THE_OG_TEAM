import 'package:flutter/material.dart';

class EquilibriumBanner extends StatelessWidget {
  final bool equilibriumReached;
  final int roundCount;

  const EquilibriumBanner({
    super.key,
    required this.equilibriumReached,
    required this.roundCount,
  });

  @override
  Widget build(BuildContext context) {
    final color = equilibriumReached ? Colors.greenAccent : Colors.orangeAccent;
    final icon = equilibriumReached ? Icons.handshake : Icons.warning_amber;
    final text = equilibriumReached
        ? 'Consensus reached in Round $roundCount'
        : 'No consensus — capped at $roundCount rounds';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

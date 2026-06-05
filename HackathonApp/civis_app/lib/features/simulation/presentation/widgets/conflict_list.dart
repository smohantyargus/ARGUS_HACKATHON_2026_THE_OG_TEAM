import 'package:flutter/material.dart';
import '../../domain/final_policy.dart';

class ConflictList extends StatelessWidget {
  final List<PolicyConflict> conflicts;
  const ConflictList({super.key, required this.conflicts});

  @override
  Widget build(BuildContext context) {
    if (conflicts.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 4),
        child: Text(
          'No conflicts detected',
          style: TextStyle(color: Colors.white38, fontStyle: FontStyle.italic),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Conflicts Resolved',
          style: TextStyle(
            color: Colors.white70,
            fontWeight: FontWeight.w700,
            fontSize: 13,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 6),
        ...conflicts.map((c) => _ConflictItem(conflict: c)),
      ],
    );
  }
}

class _ConflictItem extends StatelessWidget {
  final PolicyConflict conflict;
  const _ConflictItem({required this.conflict});

  @override
  Widget build(BuildContext context) {
    final agentStr = conflict.agents.join(' vs ');
    final field = conflict.field.isNotEmpty ? conflict.field : 'policy';
    final resolution = conflict.raw['resolution'] as String?;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.orange.withValues(alpha: 0.3)),
        boxShadow: [
          BoxShadow(
            color: Colors.orange.withValues(alpha: 0.05),
            blurRadius: 4,
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.warning_amber_rounded,
                  color: Colors.orangeAccent, size: 14),
              const SizedBox(width: 6),
              Expanded(
                child: RichText(
                  text: TextSpan(
                    style: const TextStyle(fontSize: 12),
                    children: [
                      TextSpan(
                        text: _capitalize(field),
                        style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: Colors.orangeAccent),
                      ),
                      const TextSpan(
                        text: ': ',
                        style: TextStyle(color: Colors.white54),
                      ),
                      TextSpan(
                        text: agentStr,
                        style: const TextStyle(color: Colors.white70),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (resolution != null) ...[
            const SizedBox(height: 4),
            Text(
              '→ $resolution',
              style: const TextStyle(
                  fontSize: 11,
                  color: Colors.greenAccent,
                  fontStyle: FontStyle.italic),
            ),
          ],
        ],
      ),
    );
  }

  String _capitalize(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

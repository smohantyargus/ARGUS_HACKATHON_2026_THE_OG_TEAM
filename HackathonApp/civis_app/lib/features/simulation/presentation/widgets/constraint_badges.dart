import 'package:flutter/material.dart';
import '../../domain/final_policy.dart';

class ConstraintBadges extends StatelessWidget {
  final FinalPolicy policy;
  const ConstraintBadges({super.key, required this.policy});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _badge('ICU', policy.icuOk),
        _badge('Economy', policy.economyOk),
        _badge('${policy.compliancePct}% Comply', true,
            customColor: policy.compliancePct >= 50
                ? Colors.greenAccent
                : Colors.orangeAccent),
        _badge('Supply', policy.supplyOk),
      ],
    );
  }

  Widget _badge(String label, bool ok, {Color? customColor}) {
    final color = customColor ?? (ok ? Colors.greenAccent : Colors.redAccent);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.6)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            ok ? Icons.check_circle_outline : Icons.cancel_outlined,
            size: 14,
            color: color,
          ),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(
                  color: color, fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

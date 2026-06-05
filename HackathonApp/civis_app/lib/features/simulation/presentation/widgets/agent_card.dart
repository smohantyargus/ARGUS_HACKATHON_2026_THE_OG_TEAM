import 'package:flutter/material.dart';
import '../../domain/agent_catalog.dart';
import '../../domain/job_step.dart';

class AgentCard extends StatefulWidget {
  final JobStep step;
  const AgentCard({super.key, required this.step});

  @override
  State<AgentCard> createState() => _AgentCardState();
}

class _AgentCardState extends State<AgentCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _updateAnimation();
  }

  @override
  void didUpdateWidget(AgentCard old) {
    super.didUpdateWidget(old);
    if (old.step.status != widget.step.status) _updateAnimation();
  }

  void _updateAnimation() {
    if (widget.step.status == StepStatus.inProgress) {
      _pulse.repeat(reverse: true);
    } else {
      _pulse.stop();
      _pulse.value = 1;
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final meta = agentMeta(widget.step.stepName);
    final status = widget.step.status;
    final output = widget.step.output;

    Color borderColor;
    Color bgColor;
    switch (status) {
      case StepStatus.inProgress:
        borderColor = meta?.color ?? Colors.white;
        bgColor = (meta?.color ?? Colors.white).withValues(alpha: 0.08);
        break;
      case StepStatus.completed:
        borderColor = meta?.color ?? Colors.white;
        bgColor = (meta?.color ?? Colors.white).withValues(alpha: 0.12);
        break;
      case StepStatus.failed:
        borderColor = Colors.red;
        bgColor = Colors.red.withValues(alpha: 0.1);
        break;
      default:
        borderColor = Colors.white12;
        bgColor = Colors.white.withValues(alpha: 0.03);
    }

    String? headlineValue;
    if (output != null && meta != null) {
      final raw = output[meta.headlineField];
      if (raw != null) headlineValue = raw.toString();
    }

    final confidence = output?['confidence'];
    final confText = confidence != null
        ? 'conf ${(confidence as num).toStringAsFixed(2)}'
        : null;

    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, child) {
        final opacity = status == StepStatus.inProgress
            ? 0.5 + 0.5 * _pulse.value
            : 1.0;
        return Opacity(
          opacity: opacity,
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 4),
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: borderColor, width: 1.5),
            ),
            child: ListTile(
              dense: true,
              leading: _buildLeading(meta, status),
              title: Text(
                meta?.displayName ?? widget.step.stepName,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: status == StepStatus.pending
                      ? Colors.white38
                      : Colors.white,
                ),
              ),
              subtitle: headlineValue != null
                  ? Text(
                      _truncate(headlineValue, 60),
                      style: TextStyle(
                        fontSize: 12,
                        color: meta?.color.withValues(alpha: 0.85) ??
                            Colors.white60,
                      ),
                    )
                  : null,
              trailing: _buildTrailing(status, confText),
            ),
          ),
        );
      },
    );
  }

  Widget _buildLeading(AgentMeta? meta, StepStatus status) {
    if (meta == null) {
      return const Icon(Icons.smart_toy, color: Colors.white38);
    }
    final color = status == StepStatus.pending
        ? Colors.white24
        : meta.color;
    return CircleAvatar(
      backgroundColor: color.withValues(alpha: 0.2),
      radius: 20,
      child: Icon(meta.icon, color: color, size: 20),
    );
  }

  Widget _buildTrailing(StepStatus status, String? confText) {
    switch (status) {
      case StepStatus.inProgress:
        return const SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70),
        );
      case StepStatus.completed:
        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            const Icon(Icons.check_circle, color: Colors.greenAccent, size: 18),
            if (confText != null)
              Text(confText,
                  style: const TextStyle(fontSize: 10, color: Colors.white54)),
          ],
        );
      case StepStatus.failed:
        return const Icon(Icons.error_outline, color: Colors.redAccent, size: 18);
      default:
        return const Icon(Icons.radio_button_unchecked,
            color: Colors.white24, size: 16);
    }
  }

  String _truncate(String s, int max) =>
      s.length > max ? '${s.substring(0, max)}…' : s;
}

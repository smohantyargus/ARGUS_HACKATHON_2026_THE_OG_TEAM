enum StepStatus { pending, inProgress, completed, failed }

class JobStep {
  final int id;
  final String stepName;
  final String? agentName;
  final StepStatus status;
  final Map<String, dynamic>? input;
  final Map<String, dynamic>? output;
  final String? error;
  final DateTime? startedAt;
  final DateTime? completedAt;

  const JobStep({
    required this.id,
    required this.stepName,
    this.agentName,
    required this.status,
    this.input,
    this.output,
    this.error,
    this.startedAt,
    this.completedAt,
  });

  int get round => (input?['_iteration'] as num?)?.toInt() ?? 1;

  factory JobStep.fromJson(Map<String, dynamic> j) {
    final s = j['status'] as String? ?? 'pending';
    StepStatus status;
    switch (s) {
      case 'in_progress':
        status = StepStatus.inProgress;
        break;
      case 'completed':
        status = StepStatus.completed;
        break;
      case 'failed':
        status = StepStatus.failed;
        break;
      default:
        status = StepStatus.pending;
    }
    return JobStep(
      id: (j['id'] as num).toInt(),
      stepName: j['step_name'] as String? ?? '',
      agentName: j['agent_name'] as String?,
      status: status,
      input: j['input'] as Map<String, dynamic>?,
      output: j['output'] as Map<String, dynamic>?,
      error: j['error'] as String?,
      startedAt: j['started_at'] != null
          ? DateTime.tryParse(j['started_at'] as String)
          : null,
      completedAt: j['completed_at'] != null
          ? DateTime.tryParse(j['completed_at'] as String)
          : null,
    );
  }
}

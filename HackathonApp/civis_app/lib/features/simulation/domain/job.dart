class Job {
  final String jobId;
  final String status;
  final String? currentStep;
  final String? error;
  final Map<String, dynamic>? result;

  const Job({
    required this.jobId,
    required this.status,
    this.currentStep,
    this.error,
    this.result,
  });

  bool get isTerminal =>
      const {'completed', 'failed', 'timed_out'}.contains(status);

  factory Job.fromJson(Map<String, dynamic> j) => Job(
        jobId: j['job_id'] as String,
        status: j['status'] as String? ?? 'pending',
        currentStep: j['current_step'] as String?,
        error: j['error'] as String?,
        result: j['result'] as Map<String, dynamic>?,
      );
}

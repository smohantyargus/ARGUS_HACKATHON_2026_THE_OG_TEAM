import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/job.dart';
import '../domain/job_step.dart';

class SimulationRepository {
  final Dio _dio;
  SimulationRepository(this._dio);

  Future<String> triggerAsync(String scenario, String pipelineId) async {
    try {
      final resp = await _dio.post('/v1/process/text/async', data: {
        'text': scenario,
        'pipeline_id': pipelineId,
      });
      return resp.data['job_id'] as String;
    } on DioException catch (e) {
      // Fallback to blocking endpoint if async not yet deployed
      if (e.response?.statusCode == 404) {
        return _triggerBlocking(scenario, pipelineId);
      }
      throw _wrap(e);
    }
  }

  Future<String> _triggerBlocking(String scenario, String pipelineId) async {
    try {
      final resp = await _dio.post('/v1/process/text', data: {
        'text': scenario,
        'pipeline_id': pipelineId,
      }, options: Options(receiveTimeout: const Duration(minutes: 5)));
      return resp.data['job_id'] as String;
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<Job> getJob(String jobId) async {
    try {
      final resp = await _dio.get('/v1/jobs/$jobId');
      return Job.fromJson(resp.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<List<JobStep>> getSteps(String jobId) async {
    try {
      final resp = await _dio.get('/v1/jobs/$jobId/steps');
      final data = resp.data as List<dynamic>;
      return data.map((e) => JobStep.fromJson(e as Map<String, dynamic>)).toList();
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  ApiException _wrap(DioException e) => e.error is ApiException
      ? e.error as ApiException
      : ApiException(e.message ?? 'Network error', statusCode: e.response?.statusCode);
}

final simulationRepositoryProvider = Provider<SimulationRepository>((ref) {
  return SimulationRepository(ref.watch(apiClientProvider).orchestrator);
});

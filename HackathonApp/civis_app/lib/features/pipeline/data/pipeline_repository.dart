import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/config/app_config.dart';
import '../domain/pipeline.dart';

class PipelineRepository {
  final Dio _dio;
  PipelineRepository(this._dio);

  Future<List<Pipeline>> list() async {
    try {
      final resp = await _dio.get('/pipelines/graph/');
      final data = resp.data as List<dynamic>;
      return data.map((e) => Pipeline.fromJson(e as Map<String, dynamic>)).toList();
    } on DioException catch (e) {
      throw e.error is ApiException
          ? e.error as ApiException
          : ApiException(e.message ?? 'Failed to load pipelines');
    }
  }

  Future<String> findEpidemicPipelineId() async {
    final pipelines = await list();
    final match = pipelines.firstWhere(
      (p) => p.name.toLowerCase().contains(
            AppConfig.epidemicPipelineName.toLowerCase(),
          ),
      orElse: () => throw ApiException(
        'Pipeline "${AppConfig.epidemicPipelineName}" not found',
      ),
    );
    return match.id;
  }
}

final pipelineRepositoryProvider = Provider<PipelineRepository>((ref) {
  return PipelineRepository(ref.watch(apiClientProvider).configService);
});

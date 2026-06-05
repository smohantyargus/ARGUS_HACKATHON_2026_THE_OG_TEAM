import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../storage/token_store.dart';
import '../config/app_config.dart';
import 'api_exception.dart';

class ApiClient {
  final Dio orchestrator;
  final Dio configService;

  ApiClient(this.orchestrator, this.configService);
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final store = ref.watch(tokenStoreProvider);

  Dio makeDio(String base) {
    final dio = Dio(BaseOptions(
      baseUrl: base,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));

    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await store.read();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (err, handler) async {
        if (err.response?.statusCode == 401) {
          await store.clear();
        }
        final resp = err.response;
        String msg;
        if (err.type == DioExceptionType.connectionTimeout ||
            err.type == DioExceptionType.connectionError) {
          final uri = err.requestOptions.baseUrl;
          msg = 'Cannot reach server at $uri — check that the backend is running and the device is on the same network.';
        } else if (resp?.data is Map) {
          msg = (resp!.data['detail'] ?? err.message ?? 'Unknown error').toString();
        } else {
          msg = err.message ?? 'Unknown error';
        }
        handler.reject(DioException(
          requestOptions: err.requestOptions,
          error: ApiException(msg, statusCode: resp?.statusCode),
          type: err.type,
          response: resp,
        ));
      },
    ));

    return dio;
  }

  return ApiClient(
    makeDio(AppConfig.orchestratorBase),
    makeDio(AppConfig.configServiceBase),
  );
});

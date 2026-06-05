import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/storage/token_store.dart';

class AuthRepository {
  final Dio _dio;
  final TokenStore _store;

  AuthRepository(this._dio, this._store);

  Future<void> login(String username, String password) async {
    try {
      final resp = await _dio.post('/auth/login', data: {
        'username': username,
        'password': password,
      });
      final token = resp.data['access_token'] as String?;
      if (token == null) throw ApiException('No access_token in response');
      await _store.write(token);
    } on DioException catch (e) {
      throw e.error is ApiException
          ? e.error as ApiException
          : ApiException(e.message ?? 'Login failed');
    }
  }

  Future<bool> hasToken() async => await _store.read() != null;

  Future<void> logout() => _store.clear();
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final client = ref.watch(apiClientProvider);
  final store = ref.watch(tokenStoreProvider);
  return AuthRepository(client.orchestrator, store);
});

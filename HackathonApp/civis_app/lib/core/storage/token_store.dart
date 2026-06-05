import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _kTokenKey = 'civis_jwt';

class TokenStore {
  final FlutterSecureStorage _storage;
  TokenStore(this._storage);

  Future<String?> read() => _storage.read(key: _kTokenKey);
  Future<void> write(String token) => _storage.write(key: _kTokenKey, value: token);
  Future<void> clear() => _storage.delete(key: _kTokenKey);
}

final tokenStoreProvider = Provider<TokenStore>((ref) {
  return TokenStore(const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  ));
});

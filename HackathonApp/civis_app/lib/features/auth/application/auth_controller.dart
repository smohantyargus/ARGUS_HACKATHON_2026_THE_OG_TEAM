import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/auth_repository.dart';
import '../domain/auth_state.dart';

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _checkToken();
    return const AuthState(status: AuthStatus.unknown);
  }

  Future<void> _checkToken() async {
    final has = await ref.read(authRepositoryProvider).hasToken();
    state = AuthState(
      status: has ? AuthStatus.authenticated : AuthStatus.unauthenticated,
    );
  }

  Future<void> login(String username, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      await ref.read(authRepositoryProvider).login(username, password);
      state = state.copyWith(status: AuthStatus.authenticated, isLoading: false);
    } catch (e) {
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        error: e.toString().replaceFirst('ApiException: ', ''),
        isLoading: false,
      );
    }
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

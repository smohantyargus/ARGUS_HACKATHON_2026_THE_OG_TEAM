enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  final AuthStatus status;
  final String? error;
  final bool isLoading;

  const AuthState({
    this.status = AuthStatus.unknown,
    this.error,
    this.isLoading = false,
  });

  AuthState copyWith({AuthStatus? status, String? error, bool? isLoading}) =>
      AuthState(
        status: status ?? this.status,
        error: error,
        isLoading: isLoading ?? this.isLoading,
      );
}

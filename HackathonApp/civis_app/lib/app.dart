import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/theme.dart';
import 'features/auth/application/auth_controller.dart';
import 'features/auth/domain/auth_state.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/simulation/presentation/command_center_screen.dart';

class CivisApp extends ConsumerWidget {
  const CivisApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return MaterialApp(
      title: 'CIVIS Epidemic Council',
      theme: buildTheme(),
      debugShowCheckedModeBanner: false,
      home: _authGate(auth),
    );
  }

  Widget _authGate(AuthState auth) {
    switch (auth.status) {
      case AuthStatus.authenticated:
        return const CommandCenterScreen();
      case AuthStatus.unauthenticated:
        return const LoginScreen();
      case AuthStatus.unknown:
        return const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        );
    }
  }
}

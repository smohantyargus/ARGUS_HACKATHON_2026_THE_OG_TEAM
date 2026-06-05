import 'package:flutter/foundation.dart' show kIsWeb;

class AppConfig {
  // Web (Chrome): backend runs on the same machine → use localhost.
  // Mobile (physical device): use dev-machine LAN IP.
  // Android emulator: swap LAN IP to 10.0.2.2.
  static String get orchestratorBase =>
      'http://192.1.200.70:8000';

  static String get configServiceBase =>
      'http://192.1.200.70:8010';

  static const epidemicPipelineName = 'epidemic_containment';
  static const pollInterval = Duration(milliseconds: 1500);
}

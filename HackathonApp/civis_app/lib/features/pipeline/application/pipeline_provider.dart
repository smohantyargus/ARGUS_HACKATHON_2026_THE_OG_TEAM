import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/pipeline_repository.dart';

final epidemicPipelineIdProvider = FutureProvider<String>((ref) {
  return ref.watch(pipelineRepositoryProvider).findEpidemicPipelineId();
});

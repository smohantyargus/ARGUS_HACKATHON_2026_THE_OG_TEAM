class Pipeline {
  final String id;
  final String name;
  final String? description;
  final bool isActive;

  const Pipeline({
    required this.id,
    required this.name,
    this.description,
    required this.isActive,
  });

  factory Pipeline.fromJson(Map<String, dynamic> j) => Pipeline(
        id: j['id'] as String,
        name: j['name'] as String,
        description: j['description'] as String?,
        isActive: j['is_active'] as bool? ?? false,
      );
}

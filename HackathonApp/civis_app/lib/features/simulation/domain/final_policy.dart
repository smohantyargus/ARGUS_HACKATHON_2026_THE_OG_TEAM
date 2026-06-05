class PolicyConflict {
  final String field;
  final List<String> agents;
  final Map<String, dynamic> raw;

  const PolicyConflict({
    required this.field,
    required this.agents,
    required this.raw,
  });

  factory PolicyConflict.fromJson(Map<String, dynamic> j) => PolicyConflict(
        field: j['field'] as String? ?? '',
        agents: (j['agents'] as List<dynamic>?)?.cast<String>() ?? [],
        raw: j,
      );
}

class FinalPolicy {
  final String policy;
  final String rationale;
  final bool icuOk;
  final bool economyOk;
  final bool supplyOk;
  final bool equilibriumReached;
  final int compliancePct;
  final double confidence;
  final List<PolicyConflict> conflicts;

  const FinalPolicy({
    required this.policy,
    required this.rationale,
    required this.icuOk,
    required this.economyOk,
    required this.supplyOk,
    required this.equilibriumReached,
    required this.compliancePct,
    required this.confidence,
    required this.conflicts,
  });

  factory FinalPolicy.fromResult(Map<String, dynamic> r) => FinalPolicy(
        policy: r['policy'] as String? ?? '',
        rationale: r['rationale'] as String? ?? '',
        icuOk: r['icu_ok'] == true,
        economyOk: r['economy_ok'] == true,
        supplyOk: r['supply_ok'] == true,
        compliancePct: (r['compliance_pct'] as num?)?.toInt() ?? 0,
        equilibriumReached: r['equilibrium_reached'].toString() == 'true',
        confidence: (r['confidence'] as num?)?.toDouble() ?? 0,
        conflicts: (r['_conflicts'] as List<dynamic>? ?? [])
            .map((e) => PolicyConflict.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

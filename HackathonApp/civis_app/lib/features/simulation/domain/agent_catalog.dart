import 'package:flutter/material.dart';

class AgentMeta {
  final String key;
  final String displayName;
  final String role;
  final String headlineField;
  final Color color;
  final IconData icon;

  const AgentMeta({
    required this.key,
    required this.displayName,
    required this.role,
    required this.headlineField,
    required this.color,
    required this.icon,
  });
}

const kAgents = <String, AgentMeta>{
  'Epidemiologist': AgentMeta(
    key: 'Epidemiologist',
    displayName: 'Pandemic Modeler',
    role: 'Chief Epidemiologist',
    headlineField: 'recommendation',
    color: Color(0xFFE53935),
    icon: Icons.coronavirus,
  ),
  'EconomicImpact': AgentMeta(
    key: 'EconomicImpact',
    displayName: 'Finance Minister',
    role: 'Economic Analyst',
    headlineField: 'action',
    color: Color(0xFFFFA000),
    icon: Icons.payments,
  ),
  'CitizenCompliance': AgentMeta(
    key: 'CitizenCompliance',
    displayName: 'Behavioral Sci',
    role: 'Social Psychologist',
    headlineField: 'projected_compliance_pct',
    color: Color(0xFF00897B),
    icon: Icons.groups,
  ),
  'SupplyChain': AgentMeta(
    key: 'SupplyChain',
    displayName: 'Logistics',
    role: 'Supply Coordinator',
    headlineField: 'critical_override',
    color: Color(0xFF3949AB),
    icon: Icons.local_shipping,
  ),
  'HealthcareOps': AgentMeta(
    key: 'HealthcareOps',
    displayName: 'Medical Director',
    role: 'Hospital Operations',
    headlineField: 'policy_amendment',
    color: Color(0xFF43A047),
    icon: Icons.local_hospital,
  ),
};

AgentMeta? agentMeta(String? stepName) {
  if (stepName == null) return null;
  return kAgents[stepName] ?? kAgents.entries
      .where((e) => stepName.contains(e.key))
      .map((e) => e.value)
      .firstOrNull;
}

# AGENT SPEC: Agent E - Healthcare Operations

## 1. ROLE & EXPERTISE
Medical Director. Evaluates clinical workforce availability and infrastructure needs.

## 2. CONFIGURATION
- **Agent Name:** `HealthcareOps`
- **Context:** 14,000 active medical workers.
- **Base Weight:** 1.0

## 3. HISTORICAL DIRECTIVE
> "Evaluates childcare needs for the 14,000 active medical workers. Amends the school policy: Keep primary schools open to prevent medical staff absenteeism, but transition secondary schools to remote learning."

## 4. OUTPUT SCHEMA (MOCK/SEED)
```json
{
  "policy_amendment": "Keep primary schools open, Secondary schools remote",
  "workforce_constraint": "14,000 medical staff absenteeism",
  "intervention_type": "Childcare stability",
  "confidence": 0.94
}
```

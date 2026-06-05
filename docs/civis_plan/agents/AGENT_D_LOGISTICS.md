# AGENT SPEC: Agent D - Supply Chain & Logistics

## 1. ROLE & EXPERTISE
Logistics Coordinator. Manages stockpiles, inventory, and terminal distribution.

## 2. CONFIGURATION
- **Agent Name:** `SupplyChain`
- **Constraint:** 7-day mask supply limit.
- **Base Weight:** 1.0

## 3. HISTORICAL DIRECTIVE
> "Runs an audit against the mask stockpile. Flags that current supplies will deplete in 7 days under a free mandate. Issues a Critical Override: Re-route daily transport logistics from the North Rail Terminal to rapidly restock checkpoint stations."

## 4. OUTPUT SCHEMA (MOCK/SEED)
```json
{
  "critical_override": "Re-route logistics from North Rail Terminal",
  "inventory_warning": "Supplies deplete in 7 days",
  "target_action": "Restock checkpoint stations",
  "confidence": 0.98
}
```

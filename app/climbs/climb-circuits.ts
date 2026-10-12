import type { SavedHoldRole } from "./saved-climbs";

type CircuitHold = { role: SavedHoldRole; circuitOrder?: number };

export function isCircuitOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 200;
}

export function nextCircuitOrder(holds: readonly CircuitHold[]) {
  const used = new Set(holds.filter(hold => hold.role === "hand").map(hold => hold.circuitOrder));
  let order = 1;
  while (used.has(order)) order += 1;
  return order;
}

export function setCircuitHolds<T extends CircuitHold>(holds: readonly T[], enabled: boolean): T[] {
  const numbered: T[] = [];
  for (const hold of holds) {
    const next = { ...hold };
    delete next.circuitOrder;
    if (enabled && hold.role === "hand") next.circuitOrder = nextCircuitOrder(numbered);
    numbered.push(next);
  }
  return numbered;
}

export function hasValidCircuitHolds(holds: readonly CircuitHold[], isCircuit: boolean) {
  const used = new Set<number>();
  for (const hold of holds) {
    if (!isCircuit || hold.role !== "hand") {
      if (hold.circuitOrder !== undefined) return false;
    } else {
      if (!isCircuitOrder(hold.circuitOrder) || used.has(hold.circuitOrder)) return false;
      used.add(hold.circuitOrder);
    }
  }
  return true;
}

export function missingCircuitOrders(holds: readonly CircuitHold[]) {
  const used = new Set(holds.flatMap(hold =>
    hold.role === "hand" && isCircuitOrder(hold.circuitOrder) ? [hold.circuitOrder] : [],
  ));
  const largest = Math.max(0, ...used);
  return Array.from({ length: largest }, (_, index) => index + 1).filter(order => !used.has(order));
}

export function hasCompleteCircuitSequence(holds: readonly CircuitHold[]) {
  return hasValidCircuitHolds(holds, true) && missingCircuitOrders(holds).length === 0;
}

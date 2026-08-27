import type { Execution, Trade } from './types';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BuildState {
  fills: Execution[];
  position: number;
  entryQty: number;
  entryCost: number;
  exitQty: number;
  exitCost: number;
  proceeds: number;
  commissions: number;
}

export function buildTrades(executions: Execution[]): Trade[] {
  const byContract = new Map<number, Execution[]>();
  for (const e of executions) {
    if (!byContract.has(e.conid)) byContract.set(e.conid, []);
    byContract.get(e.conid)!.push(e);
  }
  const trades: Trade[] = [];
  for (const fills of byContract.values()) {
    fills.sort(
      (a, b) => a.dateTime.getTime() - b.dateTime.getTime() || a.execId.localeCompare(b.execId),
    );
    trades.push(...buildContractTrades(fills));
  }
  trades.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  return trades;
}

function buildContractTrades(fills: Execution[]): Trade[] {
  const trades: Trade[] = [];
  let state: BuildState | null = null;
  const queue = [...fills];

  while (queue.length > 0) {
    const fill = queue.shift()!;
    if (state === null) {
      state = { fills: [], position: 0, entryQty: 0, entryCost: 0, exitQty: 0, exitCost: 0, proceeds: 0, commissions: 0 };
    }
    const next = state.position + fill.quantity;
    const crossesZero = state.position !== 0 && next !== 0 && Math.sign(next) !== Math.sign(state.position);
    if (crossesZero) {
      // Split: part closes this trade, remainder reopens in the other direction.
      const closeQty = -state.position;
      const ratio = Math.abs(closeQty / fill.quantity);
      queue.unshift(prorate(fill, fill.quantity - closeQty, 1 - ratio, ':b'));
      applyFill(state, prorate(fill, closeQty, ratio, ':a'));
    } else {
      applyFill(state, fill);
    }
    if (state.position === 0) {
      trades.push(toTrade(state, 'closed'));
      state = null;
    }
  }
  if (state !== null) trades.push(toTrade(state, 'open'));
  return trades;
}

function prorate(fill: Execution, quantity: number, ratio: number, suffix: string): Execution {
  return {
    ...fill,
    execId: fill.execId + suffix,
    quantity,
    proceeds: fill.proceeds * ratio,
    commission: fill.commission * ratio,
  };
}

function applyFill(state: BuildState, fill: Execution): void {
  const opening = state.position === 0 || Math.sign(fill.quantity) === Math.sign(state.position);
  const absQty = Math.abs(fill.quantity);
  if (opening) {
    state.entryQty += absQty;
    state.entryCost += absQty * fill.price;
  } else {
    state.exitQty += absQty;
    state.exitCost += absQty * fill.price;
  }
  state.position += fill.quantity;
  state.proceeds += fill.proceeds;
  state.commissions += fill.commission;
  state.fills.push(fill);
}

function toTrade(state: BuildState, status: 'open' | 'closed'): Trade {
  const first = state.fills[0];
  const last = state.fills[state.fills.length - 1];
  return {
    conid: first.conid,
    underlying: first.underlying,
    description: first.description,
    expiry: first.expiry,
    strike: first.strike,
    putCall: first.putCall,
    direction: first.quantity > 0 ? 'long' : 'short',
    status,
    openedAt: first.dateTime,
    closedAt: status === 'closed' ? last.dateTime : null,
    quantityOpened: state.entryQty,
    avgEntryPrice: round2(state.entryCost / state.entryQty),
    avgExitPrice: state.exitQty > 0 ? round2(state.exitCost / state.exitQty) : null,
    realizedPnl: status === 'closed' ? round2(state.proceeds + state.commissions) : null,
    commissions: round2(state.commissions),
    executionIds: state.fills.map((f) => f.execId),
  };
}

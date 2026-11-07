import type { Store } from '../lib/contracts.ts';
import type { DemoStore } from './contract.ts';

export type StoreProjection = Pick<DemoStore, 'hoje' | 'fila' | 'item' | 'dossie' | 'escaladas' | 'prova'>;

export function createIntegratedStore(store: Pick<Store, 'resolveEscalation'>, projection: StoreProjection): DemoStore {
  return {
    origem: 'integrado',
    hoje: () => projection.hoje(),
    fila: () => projection.fila(),
    item: (tender, item) => projection.item(tender, item),
    dossie: tender => projection.dossie(tender),
    escaladas: () => projection.escaladas(),
    prova: () => projection.prova(),
    decidir: (id, decision) => store.resolveEscalation(id, decision),
  };
}

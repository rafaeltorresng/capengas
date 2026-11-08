// Decisão humana na pendência (aprovar, recusar, ajustar com texto) volta para o agente e para o envio.
// Aprovar libera as pendências da escalada no envio; recusar tira o item da análise e do envio; ajustar reanalisa o item com o texto.
import type { LanceStore } from './store.ts';

type Decidida = { item?: string; motivo: string; decisao: 'aprovar' | 'recusar' | 'ajustar'; ajuste?: string };
const decididas = (store: Pick<LanceStore, 'decidedEscalations'>, tenderId: string): Decidida[] =>
  store.decidedEscalations?.(tenderId) ?? [];

/** Texto para o prompt do agente; vazio quando o humano não decidiu nada neste pregão. */
export function instrucaoHumana(store: Pick<LanceStore, 'decidedEscalations'>, tenderId: string): string {
  const linhas = decididas(store, tenderId).map(d => {
    const alvo = d.item ? `item ${d.item}` : 'pregão';
    if (d.decisao === 'recusar') return `- ${alvo}: o humano recusou ("${d.motivo}"). Não analise nem proponha este item.`;
    if (d.decisao === 'aprovar') return `- ${alvo}: o humano aprovou seguir com as pendências ("${d.motivo}").`;
    return `- ${alvo}: o humano pediu ajuste: "${d.ajuste}". Reanalise o item considerando esse ajuste e recalcule decide_item.`;
  });
  return linhas.length ? `\nDecisões do humano neste pregão (registradas na tela):\n${linhas.join('\n')}` : '';
}

export const itensRecusados = (store: Pick<LanceStore, 'decidedEscalations'>, tenderId: string) =>
  [...new Set(decididas(store, tenderId).filter(d => d.decisao === 'recusar' && d.item).map(d => Number(d.item)))];

/** A mesma pendência já decidida (aprovada ou recusada) não reabre na análise seguinte. */
export const jaDecidida = (store: Pick<LanceStore, 'decidedEscalations'>, tenderId: string, item: string, motivo: string) =>
  decididas(store, tenderId).some(d => d.item === item && d.motivo === motivo && d.decisao !== 'ajustar');

/** Pendências atuais da decisão cobertas por uma aprovação do humano para o item. */
export function pendenciasAprovadas(store: Pick<LanceStore, 'decidedEscalations'>, tenderId: string, item: number, motivos: string[]): string[] {
  const aprovadas = decididas(store, tenderId).filter(d => d.decisao === 'aprovar' && d.item === String(item));
  if (!aprovadas.length) return [];
  const textos = new Set(aprovadas.flatMap(d => d.motivo.split('; ')));
  // A escalada operacional resume as condições numa frase; a aprovação dela cobre as linhas "Operação: ...".
  const operacao = aprovadas.some(d => d.motivo.includes('Operação: '));
  return motivos.filter(m => textos.has(m) || (operacao && m.startsWith('Operação: ')));
}

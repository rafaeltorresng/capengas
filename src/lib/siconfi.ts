// Semáforo fiscal do órgão: despesa total com pessoal sobre a RCL ajustada (RGF Anexo 1, SICONFI/Tesouro)
// contra os limites da LRF (alerta, prudencial, máximo). É indicador de pressão fiscal, não de atraso de pagamento.
// Só entes (município ou estado, poder executivo); órgão federal fica sem_dado. Sem dado, nunca inventa.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson } from './http.ts';

const API = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt';
const CACHE = process.env.LANCE_CACHE_DIR ?? join(fileURLToPath(new URL('../..', import.meta.url)), 'cache');
const PCT = '% sobre a RCL Ajustada';

export type SemaforoFiscal = {
  status: 'verde' | 'amarelo' | 'vermelho' | 'sem_dado';
  resumo: string;
  ente?: string;
  dtpPct?: number;
  limites?: { alerta: number; prudencial: number; maximo: number };
  periodo?: { exercicio: number; periodicidade: 'Q' | 'S'; periodo: number };
  fonte?: string;
};

type Linha = { exercicio?: number; periodo?: number; periodicidade?: string; cod_conta?: string; coluna?: string; valor?: number };

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function semaforoDoRgf(linhas: Linha[], fonte: string): SemaforoFiscal {
  const valor = (conta: string) => linhas.find(l => l.cod_conta === conta && l.coluna === PCT && Number.isFinite(l.valor))?.valor;
  const dtp = valor('DespesaComPessoalTotal');
  const alerta = valor('LimiteDeAlertaDespesaComPessoalTotal');
  const prudencial = valor('LimitePrudencialDespesaComPessoalTotal');
  const maximo = valor('LimiteMaximoDespesaComPessoalTotal');
  if (dtp == null || alerta == null || prudencial == null || maximo == null) {
    return { status: 'sem_dado', resumo: 'RGF sem a despesa com pessoal ou sem os limites da LRF.', fonte };
  }
  const base = linhas[0];
  const periodicidade = base.periodicidade === 'S' ? 'S' : 'Q';
  const periodo = { exercicio: Number(base.exercicio), periodicidade, periodo: Number(base.periodo) } as const;
  const quando = `${periodo.periodo}º ${periodicidade === 'S' ? 'semestre' : 'quadrimestre'} de ${periodo.exercicio}`;
  const inicio = `Despesa com pessoal em ${pct(dtp)} da RCL (${quando})`;
  const [status, fim] = dtp >= maximo ? ['vermelho', `acima do máximo de ${pct(maximo)} da LRF`] as const
    : dtp >= prudencial ? ['vermelho', `acima do prudencial de ${pct(prudencial)} da LRF (vedações do art. 22)`] as const
    : dtp >= alerta ? ['amarelo', `acima do alerta de ${pct(alerta)} da LRF`] as const
    : ['verde', `abaixo do alerta de ${pct(alerta)} da LRF`] as const;
  return { status, resumo: `${inicio}, ${fim}.`, dtpPct: dtp, limites: { alerta, prudencial, maximo }, periodo, fonte };
}

const httpPadrao = (ttlMs: number) => async (url: string) => (await fetchJson(url, { cacheDir: CACHE, ttlMs, retries: 3, timeoutMs: 30000 })).data;

/** Busca o RGF mais recente publicado do ente dono do CNPJ: quadrimestres e semestres do ano e do anterior. */
export async function semaforoFiscal(cnpj: string, o: { fetch?: (url: string) => Promise<any>; hoje?: Date } = {}): Promise<SemaforoFiscal> {
  const hoje = o.hoje ?? new Date();
  try {
    const entes = await (o.fetch ?? httpPadrao(30 * 86400e3))(`${API}/entes`);
    const ente = (entes?.items ?? []).find((e: any) => String(e.cnpj ?? '').replace(/\D/g, '') === cnpj.replace(/\D/g, ''));
    if (!ente || !['M', 'E'].includes(ente.esfera)) {
      return { status: 'sem_dado', resumo: 'O CNPJ do órgão não é de município ou estado no SICONFI (órgão federal ou entidade sem RGF próprio).' };
    }
    const nome = `${ente.ente}/${ente.uf}`;
    const ano = hoje.getFullYear();
    const fetchRgf = o.fetch ?? httpPadrao(7 * 86400e3);
    for (const exercicio of [ano, ano - 1]) {
      for (const [per, nr] of [['Q', 3], ['Q', 2], ['Q', 1], ['S', 2], ['S', 1]] as const) {
        const url = `${API}/rgf?an_exercicio=${exercicio}&in_periodicidade=${per}&nr_periodo=${nr}&co_tipo_demonstrativo=RGF`
          + `&no_anexo=RGF-Anexo%2001&co_esfera=${ente.esfera}&co_poder=E&id_ente=${ente.cod_ibge}`;
        const linhas = (await fetchRgf(url))?.items ?? [];
        if (!linhas.length) continue;
        const s = semaforoDoRgf(linhas, url);
        if (s.status !== 'sem_dado') return { ...s, ente: nome };
      }
    }
    return { status: 'sem_dado', resumo: `${nome}: nenhum RGF publicado em ${ano} ou ${ano - 1}.`, ente: nome };
  } catch (e: any) {
    return { status: 'sem_dado', resumo: `SICONFI indisponível (${String(e?.message ?? e).slice(0, 80)}).` };
  }
}

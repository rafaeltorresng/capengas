import type { Operacao } from '../../src/lib/operacao.ts';
import { CAMPOS_OPERACIONAIS, ESTADOS_OPERACIONAIS, TITULOS_OPERACIONAIS, ESTADOS_REVISAO_OPERACIONAL, REVISAO_NAO_REGISTRADA } from '../../src/lib/operacao.ts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Evidence } from '@/kit';

const marcos: Record<string, string> = { ordem_fornecimento: 'recebimento da ordem de fornecimento', nota_empenho: 'recebimento da nota de empenho', pedido: 'recebimento do pedido' };

export function OperationalConditions({ operacao }: { operacao?: Operacao }) {
  if (!operacao) return <Card>
    <CardHeader><CardTitle>Condições para fornecer</CardTitle><CardDescription>Esta análise ainda não registrou as condições operacionais. Uma nova análise pode conferir esses pontos nos documentos do edital.</CardDescription></CardHeader>
  </Card>;
  const conflitos = operacao.linhas.filter(l => l.estado === 'conflito').length;
  const revisao = operacao.revisao ?? REVISAO_NAO_REGISTRADA;
  return <Card>
    <CardHeader>
      <CardTitle>Condições para fornecer</CardTitle>
      <CardDescription>{revisao.estado !== 'concluida'
        ? `${ESTADOS_REVISAO_OPERACIONAL[revisao.estado]}. ${revisao.motivo}`
        : <>{conflitos ? `${conflitos} ${conflitos === 1 ? 'conflito com o cadastro' : 'conflitos com o cadastro'}. ` : ''}{operacao.requerRevisao ? 'Há condições que precisam da sua confirmação.' : 'Revisão concluída nos trechos consultados. Ausência de cláusula não significa dispensa.'} Abra para consultar a fonte.</>}</CardDescription>
    </CardHeader>
    <CardContent>
      <Accordion>{CAMPOS_OPERACIONAIS.map(campo => {
        const linhas = operacao.linhas.filter(l => l.campo === campo);
        const estado = linhas.find(l => l.estado === 'conflito')?.estado ?? linhas.find(l => l.estado === 'confirmar')?.estado ?? linhas.find(l => l.estado === 'nao_avaliada' || l.estado === 'nao_identificada')?.estado ?? linhas[0]?.estado;
        return <AccordionItem key={campo} value={campo}>
          <AccordionTrigger><span className="flex flex-wrap items-center gap-2 text-left">{TITULOS_OPERACIONAIS[campo]}{estado && <Badge variant={estado === 'conflito' ? 'destructive' : 'outline'}>{ESTADOS_OPERACIONAIS[estado]}</Badge>}</span></AccordionTrigger>
          <AccordionContent><div className="flex flex-col gap-5">{linhas.map((linha, i) => <section key={i} className="flex flex-col gap-3">
            {linha.item !== undefined && <p className="font-medium">Item {linha.item} · {ESTADOS_OPERACIONAIS[linha.estado]}</p>}
            <p>{linha.detalhe}</p>
            {campo === 'entrega' && <p className="text-sm text-muted-foreground">Cadastro usado na análise: {operacao.perfilEntrega.prazoEntregaDias ?? 'prazo não informado'}{operacao.perfilEntrega.prazoEntregaDias ? ' dias' : ''}{operacao.perfilEntrega.prazoEntregaUnidade ? ` ${operacao.perfilEntrega.prazoEntregaUnidade === 'uteis' ? 'úteis' : 'corridos'}` : ', unidade não informada'} · Marco: {marcos[operacao.perfilEntrega.prazoEntregaMarco ?? ''] ?? 'não informado'}.</p>}
            {linha.citacoes.map((c, j) => <Evidence key={j} source={{ ...c.fonte, citacao: c.citacao }} quote />)}
            {['confirmar', 'conflito'].includes(linha.estado) && <p className="text-sm text-muted-foreground">Responsável pela confirmação: analista. A pendência permanece até a conferência.</p>}
          </section>)}</div></AccordionContent>
        </AccordionItem>;
      })}</Accordion>
    </CardContent>
  </Card>;
}

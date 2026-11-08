import { useState } from 'react';
import { Popover } from 'radix-ui';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button.tsx';

const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' });
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function TurnDateFilter({ dates, value, onChange }: {
  dates: string[]; value: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState('');
  const months = [...new Set(dates.map(date => date.slice(0, 7)))].sort();
  const current = months.includes(month) ? month : (months.at(-1) ?? '');
  const index = months.indexOf(current);
  const first = new Date(current + '-01T00:00:00Z');
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return <Popover.Root open={open} onOpenChange={next => {
    if (next) setMonth(value.slice(0, 7) || months.at(-1) || '');
    setOpen(next);
  }}>
    <Popover.Trigger asChild>
      <Button variant={value ? 'secondary' : 'outline'} size="icon" disabled={!dates.length}
        aria-label={value ? 'Alterar data selecionada: ' + dateLabel.format(new Date(value)) : 'Filtrar por data'}>
        <CalendarDays aria-hidden="true" />
      </Button>
    </Popover.Trigger>
    {current && <Popover.Portal><Popover.Content className="turn-calendar" align="start" sideOffset={8} aria-label="Filtrar turnos por data">
      <div className="calendar-heading">
        <Button variant="ghost" size="icon" aria-label="Mês anterior com turnos" disabled={index <= 0} onClick={() => setMonth(months[index - 1])}><ChevronLeft /></Button>
        <strong aria-live="polite">{monthLabel.format(first)}</strong>
        <Button variant="ghost" size="icon" aria-label="Próximo mês com turnos" disabled={index >= months.length - 1} onClick={() => setMonth(months[index + 1])}><ChevronRight /></Button>
      </div>
      <div className="calendar-days">
        {weekdays.map(day => <small key={day}>{day}</small>)}
        {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={'blank-' + i} />)}
        {Array.from({ length }, (_, i) => {
          const day = current + '-' + String(i + 1).padStart(2, '0');
          return <button key={day} type="button" disabled={!dates.includes(day)} aria-pressed={value === day}
            aria-label={dateLabel.format(new Date(day))} onClick={() => { onChange(day); setOpen(false); }}>{i + 1}</button>;
        })}
      </div>
      <p>Os dias disponíveis têm turnos registrados.</p>
    </Popover.Content></Popover.Portal>}
  </Popover.Root>;
}

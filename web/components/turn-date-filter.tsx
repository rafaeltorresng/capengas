import { useState } from 'react';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const dateLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' });

function isoFromDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateFromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function TurnDateFilter({ dates, value, onChange }: {
  dates: string[]; value: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = new Set(dates);
  const selected = value ? dateFromIso(value) : undefined;
  const latest = dates.length ? dateFromIso([...dates].sort().at(-1)!) : undefined;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger
      render={<Button variant={value ? 'secondary' : 'outline'} size="sm" disabled={!dates.length} />}
      aria-label={value ? 'Alterar data selecionada: ' + dateLabel.format(new Date(value)) : 'Filtrar por data'}
    >
      <CalendarIcon data-icon="inline-start" />
      {value ? dateLabel.format(new Date(value + 'T12:00:00Z')) : 'Data'}
    </PopoverTrigger>
    <PopoverContent className="w-auto" align="start">
      <Calendar
        mode="single"
        locale={ptBR}
        selected={selected}
        defaultMonth={selected ?? latest}
        onSelect={date => {
          if (!date) return;
          const iso = isoFromDate(date);
          if (!available.has(iso)) return;
          onChange(iso);
          setOpen(false);
        }}
        disabled={date => !available.has(isoFromDate(date))}
      />
      <p className="px-2 pb-1 text-xs text-muted-foreground">Os dias disponíveis têm turnos registrados.</p>
    </PopoverContent>
  </Popover>;
}

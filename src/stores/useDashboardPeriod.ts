import { useMemo } from "react";
import { create } from "zustand";
import { startOfMonth, endOfMonth, isSameDay, format } from "date-fns";
import { dateLocale, tr } from "@/i18n";

/**
 * Período do dashboard: um intervalo de datas real.
 *
 * Antes guardava só `selectedMonth`, e o filtro (um DateRangePicker, igual ao
 * do Financeiro) convertia o intervalo escolhido para o início do seu mês,
 * deitando fora a data final. Era por isso que "Últimos 30 dias" dava o mês
 * anterior inteiro e "Este ano" dava só janeiro: o intervalo era mesmo
 * aplicado, apenas nunca era o que se tinha escolhido.
 *
 * `null` nas duas pontas = todo o histórico (o atalho "Todo o histórico" do
 * seletor), que antes não fazia rigorosamente nada.
 */
interface DashboardPeriodState {
  from: Date | null;
  to: Date | null;
  setRange: (range: { from?: Date; to?: Date } | undefined) => void;
}

const useDashboardPeriodStore = create<DashboardPeriodState>((set) => ({
  from: startOfMonth(new Date()),
  to: endOfMonth(new Date()),
  setRange: (range) =>
    set(
      range?.from
        // Um só dia escolhido no calendário vem sem `to`.
        ? { from: range.from, to: range.to ?? range.from }
        : { from: null, to: null },
    ),
}));

export function useDashboardPeriod() {
  const from = useDashboardPeriodStore((s) => s.from);
  const to = useDashboardPeriodStore((s) => s.to);
  const setRange = useDashboardPeriodStore((s) => s.setRange);

  /**
   * Mês de referência para os painéis cujos dados estão guardados POR MÊS —
   * objetivos mensais, métricas mensais, compromissos e metas de ativação são
   * literalmente uma linha por mês (`UNIQUE(organization_id, user_id, month)`).
   * Um intervalo arbitrário não tem tradução nenhuma nessas tabelas, por isso
   * continuam a usar o mês onde o período começa. Não fica escondido: o título
   * desses cartões diz sempre de que mês são ("Objetivo Mensal — julho"), por
   * isso vê-se logo quando o período abrange mais do que esse mês.
   */
  const selectedMonth = useMemo(() => from ?? startOfMonth(new Date()), [from]);

  return { from, to, setRange, selectedMonth };
}

/**
 * Rótulo do período para os títulos dos cartões. Um mês inteiro continua a ler-se
 * "agosto 2026"; qualquer outro intervalo mostra-se como intervalo, para nunca
 * dar a entender que se está a ver um mês quando não se está.
 */
export function formatPeriodLabel(from: Date | null, to: Date | null): string {
  if (!from) return tr("todo o histórico");
  const end = to ?? from;
  if (isSameDay(from, startOfMonth(from)) && isSameDay(end, endOfMonth(from))) {
    return format(from, "MMMM yyyy", { locale: dateLocale() });
  }
  if (isSameDay(from, end)) return format(from, "dd/MM/yyyy", { locale: dateLocale() });
  return `${format(from, "dd/MM/yy", { locale: dateLocale() })} — ${format(end, "dd/MM/yy", { locale: dateLocale() })}`;
}

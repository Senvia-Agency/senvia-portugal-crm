import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar, Clock, User, Check, X, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { absenceTypeLabels, statusLabels, statusVariants, formatTimeRange } from "@/lib/rh-utils";
import type { RhAbsence } from "@/hooks/useRhAbsences";

interface Props {
  absence: RhAbsence;
  showUser?: boolean;
  isAdmin?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  isCancelling?: boolean;
}

export default function RhAbsenceCard({ absence, showUser, isAdmin, onApprove, onReject, onCancel, isCancelling }: Props) {
  const periods = absence.rh_absence_periods || [];
  const totalBusinessDays = periods.reduce((sum, p) => sum + Number(p.business_days), 0);
  const isPending = absence.status === "pending";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {showUser && (
              <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
              </div>
            )}
            <div>
              {showUser && <h3 className="font-semibold text-sm">{absence.user_name}</h3>}
              <p className="text-sm text-muted-foreground">
                {absenceTypeLabels[absence.absence_type] || absence.absence_type}
              </p>
            </div>
          </div>
          <Badge variant={statusVariants[absence.status] || "secondary"}>
            {statusLabels[absence.status] || absence.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {periods.length > 0 ? (
            periods.map((period) => {
              const isApproved = period.status === "approved";
              const isRejected = period.status === "rejected";
              const bgClass = isApproved ? "bg-green-100 dark:bg-green-900/30" : isRejected ? "bg-red-100 dark:bg-red-900/30" : "bg-secondary";

              return (
                <div key={period.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${bgClass}`}>
                  <div className="flex items-center gap-2">
                    {isApproved && <Check className="h-3 w-3 text-green-600 dark:text-green-400" />}
                    {isRejected && <X className="h-3 w-3 text-red-600 dark:text-red-400" />}
                    <span>
                      {period.start_date === period.end_date
                        ? format(new Date(period.start_date), "dd MMM yyyy", { locale: pt })
                        : <>{format(new Date(period.start_date), "dd MMM", { locale: pt })} - {format(new Date(period.end_date), "dd MMM yyyy", { locale: pt })}</>}
                      {period.period_type === "partial" && period.start_time && period.end_time && (
                        <span className="opacity-70 ml-1">({formatTimeRange(period.start_time, period.end_time)})</span>
                      )}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {Number(period.business_days)} {Number(period.business_days) === 1 ? "dia" : "dias"}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2 text-sm">
              <span>
                {format(new Date(absence.start_date), "dd MMM", { locale: pt })} - {format(new Date(absence.end_date), "dd MMM yyyy", { locale: pt })}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Total: {totalBusinessDays} dias úteis</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(absence.created_at), "dd/MM/yyyy", { locale: pt })}
          </p>
        </div>

        {absence.notes && (
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-sm text-muted-foreground"><span className="font-medium">Notas:</span> {absence.notes}</p>
          </div>
        )}

        {absence.rejection_reason && (
          <div className="bg-destructive/10 rounded-lg p-3">
            <p className="text-sm text-destructive"><span className="font-medium">Motivo da rejeição:</span> {absence.rejection_reason}</p>
          </div>
        )}

        {isPending && isAdmin && onApprove && onReject && (
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={onApprove} className="flex-1">
              <Check className="h-4 w-4 mr-1" /> Aprovar
            </Button>
            <Button size="sm" variant="destructive" onClick={onReject} className="flex-1">
              <X className="h-4 w-4 mr-1" /> Rejeitar
            </Button>
          </div>
        )}

        {isPending && !isAdmin && onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={isCancelling} className="w-full text-destructive">
            <Trash2 className="h-4 w-4 mr-1" /> {isCancelling ? "A cancelar..." : "Cancelar Pedido"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

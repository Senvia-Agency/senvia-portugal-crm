import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCreditNote } from "@/hooks/useCreateCreditNote";

interface CreateCreditNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  saleId?: string;
  paymentId?: string;
  documentId: number;
  invoiceId?: string;
  documentType: "invoice" | "invoice_receipt" | "receipt" | "credit_note";
  documentReference: string;
}

export function CreateCreditNoteModal({
  open,
  onOpenChange,
  organizationId,
  saleId,
  paymentId,
  documentId,
  invoiceId,
  documentType,
  documentReference,
}: CreateCreditNoteModalProps) {
  const [reason, setReason] = useState("");
  const createCreditNote = useCreateCreditNote();

  const handleSubmit = () => {
    if (!reason.trim()) return;
    createCreditNote.mutate(
      {
        organizationId,
        saleId,
        paymentId,
        originalDocumentId: documentId,
        invoiceId,
        originalDocumentType: documentType,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          setReason("");
          onOpenChange(false);
        },
      }
    );
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) setReason("");
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-destructive" />
            Emitir Nota de Crédito
          </DialogTitle>
          <DialogDescription>
            Será criada uma Nota de Crédito referente ao documento <strong>{documentReference}</strong>. 
            Todos os itens serão creditados pelo valor integral. A nota emitida é um documento fiscal definitivo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credit-note-reason">Motivo *</Label>
            <Textarea
              id="credit-note-reason"
              placeholder="Indique o motivo da nota de crédito..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={createCreditNote.isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!reason.trim() || createCreditNote.isPending}
          >
            {createCreditNote.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                A emitir...
              </>
            ) : (
              "Emitir Nota de Crédito"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

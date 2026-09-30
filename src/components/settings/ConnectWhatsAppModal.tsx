import { useEffect, useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, RefreshCw, Smartphone, AlertCircle, Clock } from "lucide-react";
import { useWhatsappConnect, useWhatsappStatus } from "@/hooks/useMessagingChannels";

interface ConnectWhatsAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Reconnect an existing caixa (by id), or create a new one with this label.
  channelId?: string;
  label?: string;
}

/**
 * Links a WhatsApp number by QR code (Evolution). Restored from the first
 * integration (removed in f9b645fa) — the QR lifecycle below is the part that
 * took the longest to get right, so it is kept as it was.
 */
export function ConnectWhatsAppModal({ open, onOpenChange, channelId, label }: ConnectWhatsAppModalProps) {
  const { mutateAsync: connect, isPending } = useWhatsappConnect();
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrExpiry, setQrExpiry] = useState(0);
  // For a new caixa the id is only known after the first connect() response.
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(channelId);
  // Ref avoids stale closures: always reconnects the SAME caixa instead of
  // creating a new row, and never fires while one is already in flight.
  const activeIdRef = useRef<string | undefined>(channelId);
  const inFlightRef = useRef(false);

  // Poll only once we KNOW which caixa we're connecting.
  const { data: status } = useWhatsappStatus(open && !!activeChannelId, activeChannelId);
  const connected = status?.status === "connected";

  // whatsapp-status returns the live QR when Evolution includes it in
  // connectionState. Using it means /instance/connect/ is never called again
  // after the first one — calling it regenerates the QR and cancels a scan.
  const displayQr = status?.qr ?? qr;

  // Fetch (or refresh) the QR code: on open, and shortly before it expires.
  const refreshQr = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setErrorMsg(null);
      const data = await connect({ channelId: activeIdRef.current ?? channelId, label });
      if (data.channel_id) {
        activeIdRef.current = data.channel_id;
        setActiveChannelId(data.channel_id);
      }
      if (data.already_connected) {
        setQr(null);
        setPairingCode(null);
        return;
      }
      setQr(data.qr ?? null);
      setPairingCode(data.pairing_code ?? null);
    } catch (e) {
      setErrorMsg((e as Error).message || "Não foi possível gerar o QR code.");
    } finally {
      inFlightRef.current = false;
    }
  }, [connect, channelId, label]);

  useEffect(() => {
    if (open) {
      activeIdRef.current = channelId;
      setActiveChannelId(channelId);
      refreshQr();
    } else {
      setQr(null);
      setPairingCode(null);
      setErrorMsg(null);
      setQrExpiry(0);
      activeIdRef.current = channelId;
      setActiveChannelId(channelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Baileys rotates the QR about every 20s; scanning an expired one leaves the
  // phone stuck on "A ligar...". Count down on every new code.
  useEffect(() => {
    if (displayQr) setQrExpiry(20);
  }, [displayQr]);

  useEffect(() => {
    if (!displayQr || qrExpiry <= 0) return;
    const t = setTimeout(() => setQrExpiry((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [displayQr, qrExpiry]);

  // Refresh a few seconds BEFORE expiry, so the next code is on screen when the
  // old one dies. Not when the status poll already supplies fresh codes.
  useEffect(() => {
    if (qrExpiry > 3 || !displayQr || isPending || connected) return;
    if (status?.qr) return;
    refreshQr();
  }, [qrExpiry, displayQr, isPending, connected, refreshQr, status?.qr]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-green-600" />
            Ligar WhatsApp
          </DialogTitle>
          <DialogDescription>
            Liga o teu número por QR code. As conversas passam a aparecer na Caixa de Entrada, e o
            número continua a funcionar no telemóvel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-4 min-h-[320px]">
          {connected ? (
            <div className="flex flex-col items-center text-center gap-3">
              <CheckCircle2 className="h-14 w-14 text-green-600" />
              <div>
                <p className="font-semibold">WhatsApp ligado</p>
                {status?.phone_number && (
                  <p className="text-sm text-muted-foreground">+{status.phone_number}</p>
                )}
              </div>
              <Button onClick={() => onOpenChange(false)} className="mt-2">Concluir</Button>
            </div>
          ) : errorMsg ? (
            <div className="flex flex-col items-center text-center gap-3">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive max-w-xs">{errorMsg}</p>
              <Button variant="outline" onClick={refreshQr} disabled={isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          ) : isPending && !displayQr ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin" />
              <p className="text-sm">A gerar o QR code...</p>
            </div>
          ) : displayQr ? (
            <div className="flex flex-col items-center gap-4">
              <div className={`rounded-lg border bg-white p-3 transition-opacity ${qrExpiry === 0 ? "opacity-30" : ""}`}>
                <img src={displayQr} alt="QR code do WhatsApp" className="h-56 w-56" />
              </div>
              {qrExpiry > 0 ? (
                <>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Abre o <strong>WhatsApp</strong> no telemóvel</li>
                    <li>Vai a <strong>Definições → Dispositivos ligados</strong></li>
                    <li>Toca em <strong>Ligar um dispositivo</strong> e aponta para o código</li>
                  </ol>
                  {pairingCode && (
                    <p className="text-xs text-muted-foreground">
                      Ou usa o código: <span className="font-mono font-semibold">{pairingCode}</span>
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> O QR code expira em {qrExpiry}s
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  A atualizar o QR code...
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin" />
              <p className="text-sm">A preparar a ligação...</p>
            </div>
          )}
        </div>

        {/* Esta ligação não é a API oficial da Meta. Quem a usa tem de o saber
            antes de ligar o número da empresa, não depois de o perder. */}
        {!connected && (
          <p className="border-t pt-3 text-[11px] text-muted-foreground">
            Esta ligação usa o WhatsApp Web, não a API oficial da Meta. Envios em massa ou para
            quem não te conhece podem levar o WhatsApp a bloquear o número.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

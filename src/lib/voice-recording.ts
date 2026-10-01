export interface VoiceRecordingDelivery {
  cancelled: boolean;
  byteLength: number;
}

export function shouldDeliverVoiceRecording({ cancelled, byteLength }: VoiceRecordingDelivery): boolean {
  return !cancelled && byteLength > 1_000;
}

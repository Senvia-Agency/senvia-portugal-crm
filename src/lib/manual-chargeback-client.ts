export interface ManualChargebackClientOption {
  readonly id: string;
  readonly name: string;
}

export interface ManualChargebackClientReference {
  readonly clientId: string | null;
  readonly clientName: string | null;
}

export function resolveManualChargebackClient(
  rawName: string,
  clients: readonly ManualChargebackClientOption[],
): ManualChargebackClientReference {
  const clientName = rawName.trim();
  if (!clientName) return { clientId: null, clientName: null };

  const normalizedName = clientName.toLocaleLowerCase('pt-PT');
  const existingClient = clients.find(
    (client) => client.name.trim().toLocaleLowerCase('pt-PT') === normalizedName,
  );

  return {
    clientId: existingClient?.id ?? null,
    clientName: existingClient?.name ?? clientName,
  };
}

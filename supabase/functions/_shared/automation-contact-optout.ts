interface OptoutDatabase {
  rpc(name: string, args: Readonly<Record<string, string | null>>): PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
}
export async function automationContactSuppressed(
  db: OptoutDatabase, organizationId: string, phone?: string | null, email?: string | null,
): Promise<boolean> {
  const { data, error } = await db.rpc('automation_contact_is_suppressed', {
    p_org_id: organizationId, p_phone: phone ?? null, p_email: email ?? null,
  });
  if (error) throw new Error('Não foi possível confirmar a preferência de mensagens automáticas');
  return data === true;
}


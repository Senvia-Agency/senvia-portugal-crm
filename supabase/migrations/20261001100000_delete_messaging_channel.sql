-- Deleting a caixa on purpose.
--
-- Until now a caixa could only be archived: meta_conversations (and the email
-- tables) are ON DELETE CASCADE to messaging_channels, so deleting the row
-- takes every conversation of that caixa with it, and the guard below refused
-- any delete that would. The admins asked to be able to delete caixas
-- outright. Deletion stays impossible from the browser; it goes through
-- delete_messaging_channel, called only by the edge functions (meta-connect,
-- whatsapp-disconnect) after they have disconnected the provider and checked
-- that the caller is an admin of the organization. The screen tells the admin
-- how many conversations go with it before asking to confirm.

CREATE OR REPLACE FUNCTION public.impedir_apagar_caixa_com_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n INTEGER;
BEGIN
  -- Exceção: a organização inteira está a ser eliminada.
  --
  -- `messaging_channels.organization_id` é ON DELETE CASCADE, por isso apagar
  -- uma organização faz o Postgres apagar as caixas dela — e este gatilho
  -- dispararia a meio, deixando a eliminação da organização impossível. Nesse
  -- caso a linha da organização JÁ NÃO EXISTE (as ações de cascata correm
  -- depois de o pai sair), e é assim que se distinguem os dois casos.
  --
  -- Quando é o inquilino todo a sair, as conversas vão com ele: é o que um
  -- pedido de eliminação de conta quer dizer.
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;

  -- Exceção: um administrador pediu para excluir a caixa, já avisado de
  -- quantas conversas vão com ela (delete_messaging_channel).
  IF current_setting('senvia.allow_channel_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO n
    FROM public.meta_conversations c
   WHERE c.channel_id = OLD.id;

  IF n > 0 THEN
    RAISE EXCEPTION
      'A caixa "%" tem % conversa(s) guardadas e não pode ser apagada. Arquiva-a (archived_at) — o histórico dos clientes não se elimina.',
      COALESCE(OLD.label, OLD.id::text), n
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END $function$;

-- Deletes one caixa of one organization, with its conversations. Returns how
-- many conversations went with it. The flag is transaction-local, so it
-- covers this delete and nothing else.
CREATE OR REPLACE FUNCTION public.delete_messaging_channel(p_channel_id uuid, p_organization_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n
    FROM public.meta_conversations c
   WHERE c.channel_id = p_channel_id;

  PERFORM set_config('senvia.allow_channel_delete', 'on', true);
  DELETE FROM public.messaging_channels
   WHERE id = p_channel_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrada nesta organização' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM set_config('senvia.allow_channel_delete', 'off', true);

  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.delete_messaging_channel(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_messaging_channel(uuid, uuid) TO service_role;

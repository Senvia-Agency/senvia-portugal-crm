
create table public.automation_contact_suppressions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_key text not null,
  email text,
  reason text not null default 'Pedido para parar mensagens automáticas',
  source_message_id uuid,
  created_at timestamptz not null default now(),
  primary key (organization_id, phone_key)
);
alter table public.automation_contact_suppressions enable row level security;
revoke all on public.automation_contact_suppressions from public, anon, authenticated;
grant all on public.automation_contact_suppressions to service_role;
create index automation_suppression_email_idx on public.automation_contact_suppressions(organization_id,lower(email)) where email is not null;

create function public.automation_is_optout_request(p_text text) returns boolean
language sql immutable set search_path='' as $$
 select case when t ~ '(^| )nao (quero|pretendo|desejo) cancelar' then false else
 t ~ '^(stop|sair|cancelar|cancelar subscricao|cancelar assinatura|remover|unsubscribe)$'
 or t ~ '(^| )(quero|pretendo|desejo|gostaria de) cancelar( (a |o |as |os |minha |meu )?(subscricao|assinatura|conta|teste|servico|mensagens))?$'
 or t ~ '(^| )nao (quero|desejo|pretendo) (mais )?receber( mais)? (estas |as |suas |vossas )?mensagens'
 or t ~ '(^| )(parem|pare|parar) de (enviar|mandar)( me)?( mais)? mensagens'
 or t ~ '(^| )nao (me )?(enviem|mande|mandem|envie)( mais)? mensagens'
 end
 from (select trim(regexp_replace(translate(lower(coalesce(p_text,'')),
 'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g')) as t) n;
$$;

create function public.automation_contact_is_suppressed(p_org_id uuid,p_phone text default null,p_email text default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.automation_contact_suppressions s
 where s.organization_id=p_org_id and
 ((public.automation_phone_key(p_phone) is not null and s.phone_key=public.automation_phone_key(p_phone))
 or (nullif(trim(p_email),'') is not null and lower(s.email)=lower(trim(p_email)))));
$$;
revoke all on function public.automation_contact_is_suppressed(uuid,text,text) from public,anon,authenticated;
grant execute on function public.automation_contact_is_suppressed(uuid,text,text) to service_role;

create function public.record_automation_contact_optout(p_org_id uuid,p_phone text,p_source_message_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare
 k text := public.automation_phone_key(p_phone);
 e text;
begin
 if k is null then return false; end if;
 select lower(trim(c.email)) into e from public.marketing_contacts c
 where c.organization_id=p_org_id and public.automation_phone_key(c.phone)=k and nullif(trim(c.email),'') is not null limit 1;
 if e is null then
  select lower(trim(l.email)) into e from public.leads l
  where l.organization_id=p_org_id and public.automation_phone_key(l.phone)=k and nullif(trim(l.email),'') is not null limit 1;
 end if;
 if p_org_id='06fe9e1d-9670-45b0-8717-c5a6e90be380'::uuid then
  if e is null then
   select lower(u.email) into e from public.organizations o
   join public.organization_members m on m.organization_id=o.id and m.role='admin' and m.is_active
   join auth.users u on u.id=m.user_id
   where public.automation_phone_key(o.contact_phone)=k order by m.joined_at limit 1;
  end if;
  update public.organizations set wa_nudge_optout=true where public.automation_phone_key(contact_phone)=k;
 end if;
 insert into public.automation_contact_suppressions(organization_id,phone_key,email,source_message_id)
 values(p_org_id,k,e,p_source_message_id)
 on conflict(organization_id,phone_key) do update set email=coalesce(excluded.email,automation_contact_suppressions.email);
 update public.marketing_contacts set subscribed=false where organization_id=p_org_id
 and (public.automation_phone_key(phone)=k or (e is not null and lower(email)=e));
 update public.automation_runs set status='cancelled',wake_at=null,completed_at=now(),last_error='Contacto pediu para parar mensagens automáticas'
 where organization_id=p_org_id and (contact_phone_key=k or (e is not null and lower(contact_email)=e))
 and status in ('running','waiting','awaiting_reply');
 update public.scheduled_messages set status='cancelled',error='Contacto pediu para parar mensagens automáticas'
 where organization_id=p_org_id and public.automation_phone_key(phone)=k and status in ('pending','processing');
 update public.automation_queue set status='cancelled' where organization_id=p_org_id
 and (public.automation_phone_key(variables->>'telefone')=k or (e is not null and lower(recipient_email)=e))
 and status in ('pending','processing');
 return true;
end;
$$;
revoke all on function public.record_automation_contact_optout(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_automation_contact_optout(uuid,text,uuid) to service_role;

create function public.capture_automation_contact_optout() returns trigger
language plpgsql security definer set search_path='' as $$
declare phone text;
begin
 if new.direction<>'incoming' or not public.automation_is_optout_request(new.content) then return new; end if;
 select c.contact_ref into phone from public.meta_conversations c
 join public.messaging_channels ch on ch.id=c.channel_id and ch.organization_id=c.organization_id
 where c.id=new.conversation_id and c.organization_id=new.organization_id and ch.channel_type='whatsapp';
 if phone ~ '^[+]?[0-9]{9,15}$' then
  perform public.record_automation_contact_optout(new.organization_id,phone,new.id);
 end if;
 return new;
end;
$$;
revoke all on function public.capture_automation_contact_optout() from public,anon,authenticated;
create trigger capture_automation_contact_optout after insert on public.meta_messages
for each row execute function public.capture_automation_contact_optout();

create function public.guard_automation_contact_optout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('running','waiting','awaiting_reply') and
 public.automation_contact_is_suppressed(new.organization_id,new.contact_phone,new.contact_email) then
  new.status:='cancelled'; new.wake_at:=null; new.completed_at:=now();
  new.last_error:='Contacto pediu para parar mensagens automáticas';
 end if;
 return new;
end;
$$;
revoke all on function public.guard_automation_contact_optout() from public,anon,authenticated;
create trigger guard_automation_contact_optout before insert or update on public.automation_runs
for each row execute function public.guard_automation_contact_optout();


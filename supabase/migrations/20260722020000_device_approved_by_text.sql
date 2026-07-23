-- Correção: master_users.id é texto (ex.: 'mst_...'), não uuid. A coluna
-- member_devices.approved_by (criada como uuid na migração anterior) precisa ser
-- text para aceitar o id do master que aprova o aparelho. Sem isso, aprovar um
-- aparelho falhava com: invalid input syntax for type uuid: "mst_...".
alter table public.member_devices
  alter column approved_by type text using approved_by::text;

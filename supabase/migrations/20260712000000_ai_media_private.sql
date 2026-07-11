-- Fecha o bucket `ai-media` (imagens que clientes enviam pela IA no WhatsApp).
-- Antes era PÚBLICO: qualquer um com a URL abria a foto do cliente (PII).
-- Agora é privado + RLS por pasta (foldername[1] = company_id), no mesmo padrão
-- de os-fotos/os-assinaturas/ponto-docs. O app assina a URL na hora de exibir
-- (componente SignedImg), então imagens antigas e novas continuam funcionando
-- só para membros da própria empresa.

update storage.buckets set public = false where id = 'ai-media';

drop policy if exists ai_media_select on storage.objects;
create policy ai_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ai-media'
    and (storage.foldername(name))[1] in (
      select company_members.company_id from company_members
      where company_members.user_id = auth.uid()
    )
  );

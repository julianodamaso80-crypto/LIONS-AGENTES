-- =========================================================
-- STORAGE BUCKET POLICIES
-- =========================================================
-- Execute este SQL APÓS criar os buckets no Supabase:
-- 1. avatars (público)
-- 2. chat-media (público)
-- 3. voice-messages (público)
-- =========================================================

-- =========================================================
-- BUCKET: avatars
-- =========================================================
-- Permite que qualquer um veja avatares
CREATE POLICY "Public Read" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'avatars');

-- Permite upload de avatares
CREATE POLICY "Public Upload Avatars" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'avatars');

-- Permite atualizar avatares
CREATE POLICY "Public Update Avatars" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'avatars') 
WITH CHECK (bucket_id = 'avatars');

-- Permite deletar avatares
CREATE POLICY "Public Delete Avatars" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'avatars');

-- =========================================================
-- BUCKET: chat-media
-- =========================================================
-- Qualquer um pode ver imagens do chat
CREATE POLICY "Qualquer um pode ver imagens" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'chat-media');

-- Permite upload via chat
CREATE POLICY "Permitir upload via chat" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'chat-media');

-- Apenas usuários autenticados podem deletar
CREATE POLICY "Admins podem deletar" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');

-- =========================================================
-- BUCKET: voice-messages
-- =========================================================
-- Qualquer um pode ler mensagens de voz
CREATE POLICY "Anyone can read voice messages" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'voice-messages');

-- Qualquer um pode enviar mensagens de voz
CREATE POLICY "Anyone can upload to voice-messages" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'voice-messages');

-- Política adicional de leitura
CREATE POLICY "Anyone can read voice-messages" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'voice-messages');

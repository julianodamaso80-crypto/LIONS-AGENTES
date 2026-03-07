"""
Webhook API - Recebe mensagens do WhatsApp via Z-API
Corrigido: Datas ISO e Sanitização de Logs
"""

import asyncio
import logging
from datetime import date, datetime, timezone  # Importado datetime e timezone
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.auth import require_master_admin
from app.core.config import settings
from app.core.database import get_supabase_client
from app.core.rate_limit import limiter
from app.services.audio_service import AudioService

# Services
from app.services.integration_service import get_integration_service
from app.services.langchain_service import LangChainService
from app.services.message_buffer_service import message_buffer_service
from app.services.whatsapp_service import get_whatsapp_service

# Configuração de Logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton Services
supabase = get_supabase_client()
integration_service = get_integration_service(supabase.client)
whatsapp_service = get_whatsapp_service()


# ==============================================================================
# PYDANTIC MODELS (Definições de Dados)
# ==============================================================================

class ZAPITextMessage(BaseModel):
    message: str

class ZAPIAudioMessage(BaseModel):
    audioUrl: Optional[str] = None

class ZAPIImageMessage(BaseModel):
    """Imagem recebida via WhatsApp"""
    imageUrl: str
    caption: Optional[str] = None
    mimeType: Optional[str] = None

class ZAPIWebhookPayload(BaseModel):
    """Payload recebido da Z-API"""
    connectedPhone: str
    phone: str
    isGroup: bool = False
    fromMe: bool = False
    text: Optional[ZAPITextMessage] = None
    audio: Optional[ZAPIAudioMessage] = None
    image: Optional[ZAPIImageMessage] = None
    messageId: Optional[str] = None
    momment: Optional[int] = None
    senderName: Optional[str] = None

# --- MODELS QUE ESTAVAM FALTANDO ---
class AdminSendMessagePayload(BaseModel):
    """Payload para envio de mensagem pelo Admin"""
    session_id: str  # Format: whatsapp:{phone}:{company_id}:{agent_id}
    phone: str
    message: Optional[str] = None
    image_url: Optional[str] = None
    audio_url: Optional[str] = None

class StatusUpdatePayload(BaseModel):
    """Payload para atualização de status"""
    status: str  # 'open', 'HUMAN_REQUESTED', 'resolved'


# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

async def get_or_create_conversation(
    supabase_client,
    company_id: str,
    user_id: str,
    session_id: str,
    message_text: str,
    payload: ZAPIWebhookPayload,
    channel: str = "whatsapp",
    agent_id: Optional[str] = None,
) -> str:
    try:
        # Tentar encontrar conversa existente
        query = (
            supabase_client.table("conversations")
            .select("id, unread_count")
            .eq("company_id", company_id)
            .eq("user_id", user_id)
            .eq("channel", channel)
        )

        if agent_id:
            query = query.eq("agent_id", agent_id)
        else:
            query = query.is_("agent_id", "null")

        # Non-blocking DB call
        response = await asyncio.to_thread(lambda: query.limit(1).execute())

        # CORREÇÃO: Data em formato ISO UTC
        current_time_iso = datetime.now(timezone.utc).isoformat()

        if response.data and len(response.data) > 0:
            conv = response.data[0]
            conversation_id = conv["id"]
            current_unread = conv.get("unread_count") or 0

            await asyncio.to_thread(
                lambda: supabase_client.table("conversations").update(
                    {
                        "last_message_preview": message_text[:100],
                        "last_message_at": current_time_iso, # FIX: Não usar string "now()"
                        "unread_count": current_unread + 1,
                    }
                ).eq("id", conversation_id).execute()
            )
            return conversation_id

        # Criar nova conversa
        logger.info(f"[CONVERSATION] Creating new conversation for user {user_id}")
        new_conv = {
            "company_id": company_id,
            "user_id": user_id,
            "session_id": session_id,
            "agent_id": agent_id,
            "user_name": payload.senderName or "Usuário WhatsApp",
            "user_phone": payload.phone,
            "channel": channel,
            "agent_name": "Scale AI Agent",
            "status": "open",
            "status_color": "green",
            "unread_count": 1,
            "last_message_preview": message_text[:100],
            "last_message_at": current_time_iso, # FIX: Data correta
        }

        insert_response = await asyncio.to_thread(
            lambda: supabase_client.table("conversations").insert(new_conv).execute()
        )

        if insert_response.data:
            return insert_response.data[0]["id"]

        raise Exception("Failed to create conversation")

    except Exception as e:
        logger.error(f"[CONVERSATION] Error in get_or_create: {str(e)}")
        raise


# ===== HELPER: PROCESS IMAGE (VISION) =====
async def process_image_for_vision(
    image_url: str, company_id: str, supabase_client
) -> Optional[str]:
    try:
        logger.debug(f"[VISION] Downloading image from: {image_url}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(image_url)
            response.raise_for_status()
            image_bytes = response.content

        if len(image_bytes) > 5 * 1024 * 1024:
            logger.warning(f"[VISION] Image too large: {len(image_bytes)} bytes")
            return None

        # Gerar caminho único
        today = date.today().isoformat()
        file_id = str(uuid4())
        file_path = f"{company_id}/{today}/{file_id}.jpg"

        # Upload
        await asyncio.to_thread(
            lambda: supabase_client.storage.from_("chat-media").upload(
                file_path,
                image_bytes,
                {"content-type": "image/jpeg", "cache-control": "3600"},
            )
        )

        # URL pública
        public_url = supabase_client.storage.from_("chat-media").get_public_url(file_path)
        logger.info(f"[VISION] Uploaded image: {public_url}")
        return public_url

    except Exception as e:
        logger.error(f"[VISION] Error processing image: {str(e)}")
        return None


# ===== HELPER: PROCESS AUDIO (STORAGE) =====
async def process_audio_for_storage(
    audio_url: str, company_id: str, supabase_client
) -> Optional[str]:
    try:
        logger.debug(f"[AUDIO STORAGE] Downloading audio from: {audio_url}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(audio_url)
            response.raise_for_status()
            audio_bytes = response.content

        file_id = str(uuid4())
        today = date.today().isoformat()
        file_path = f"{company_id}/{today}/{file_id}.ogg"

        await asyncio.to_thread(
            lambda: supabase_client.storage.from_("voice-messages").upload(
                file_path,
                audio_bytes,
                {"content-type": "audio/ogg", "cache-control": "3600"},
            )
        )

        public_url = supabase_client.storage.from_("voice-messages").get_public_url(file_path)
        logger.info(f"[AUDIO STORAGE] Saved audio: {public_url}")
        return public_url

    except Exception as e:
        logger.error(f"[AUDIO STORAGE] Error processing audio: {str(e)}")
        return None


# ==============================================================================
# MAIN BACKGROUND TASK
# ==============================================================================
async def process_whatsapp_message_background(
    payload_dict: dict, combined_message: Optional[str] = None
):
    """Processa mensagem WhatsApp em background (Evita bloqueio do Webhook)"""
    try:
        # LOG SANITIZADO: Apenas último 4 dígitos do telefone
        safe_phone = f"...{str(payload_dict.get('phone', ''))[-4:]}"
        logger.info(f"[WEBHOOK BG] Processing for {safe_phone}")

        payload = ZAPIWebhookPayload(**payload_dict)

        # 1. Resolver Integração
        integration = integration_service.get_integration_by_phone(payload.connectedPhone)
        if not integration:
            logger.error(f"[WEBHOOK] No integration found for {payload.connectedPhone}")
            return

        company_id = integration["company_id"]
        agent_id = integration.get("agent_id")

        # 2. Resolver Usuário
        user_id = integration_service.get_or_create_user(
            phone=payload.phone, company_id=company_id, name=payload.senderName
        )

        agent_suffix = agent_id if agent_id else "default"
        session_id = f"whatsapp:{payload.phone}:{company_id}:{agent_suffix}"

        # Check de Status (Modo Humano)
        is_human_mode = False
        try:
            check_status = await asyncio.to_thread(
                lambda: supabase.client.table("conversations")
                .select("status")
                .eq("session_id", session_id)
                .limit(1)
                .execute()
            )
            if check_status.data and len(check_status.data) > 0:
                if check_status.data[0].get("status") == "HUMAN_REQUESTED":
                    is_human_mode = True
                    logger.info("[WEBHOOK] 👤 Modo Humano detectado. Pulando IA.")
        except Exception as e:
            logger.warning(f"[WEBHOOK] Failed to check status: {e}")

        # 3. Processar Conteúdo
        message_text = None
        final_audio_url = None
        final_image_url = None

        if combined_message:
            message_text = combined_message

        elif payload.audio and payload.audio.audioUrl:
            if is_human_mode:
                final_audio_url = await process_audio_for_storage(
                    payload.audio.audioUrl, company_id, supabase.client
                )
                message_text = "[Mensagem de voz]"
            else:
                logger.info("[WEBHOOK] Transcribing Audio with Whisper...")
                try:
                    audio_service = AudioService(settings.OPENAI_API_KEY)
                    message_text = audio_service.transcribe_audio_from_url(
                        payload.audio.audioUrl,
                        company_id=company_id,
                        agent_id=agent_id
                    )
                    # LOG SANITIZADO
                    logger.info("[WEBHOOK] Processing Audio Message")
                except Exception as e:
                    logger.error(f"Whisper failed: {e}")
                    whatsapp_service.send_message(payload.phone, "Erro ao processar áudio.", integration)
                    return

        elif payload.text and payload.text.message:
            message_text = payload.text.message
            # LOG SANITIZADO
            logger.info(f"[WEBHOOK] Processing Text Message (len={len(message_text)})")

        elif payload.image:
            final_image_url = await process_image_for_vision(
                payload.image.imageUrl, company_id, supabase.client
            )
            message_text = payload.image.caption or ("📷 [Imagem]" if is_human_mode else "🖼️ [Imagem enviada]")
            logger.info(f"[WEBHOOK] Image processed. URL: {final_image_url}")

        else:
            logger.error("[WEBHOOK BACKGROUND] No valid message content found")
            return

        if not message_text:
            return

        # 4. Get Conversation
        conversation_id = await get_or_create_conversation(
            supabase_client=supabase.client,
            company_id=company_id,
            user_id=user_id,
            session_id=session_id,
            message_text=message_text,
            payload=payload,
            channel="whatsapp",
            agent_id=agent_id,
        )

        # 5. Salvar Msg Usuário
        try:
            user_message_data = {
                "conversation_id": conversation_id,
                "role": "user",
                "content": message_text,
                "type": "voice" if final_audio_url else "text",
                "audio_url": final_audio_url,
                "image_url": final_image_url,
            }
            await asyncio.to_thread(
                lambda: supabase.client.table("messages").insert(user_message_data).execute()
            )
            logger.info("[MESSAGES] User message saved.")
        except Exception as e:
            logger.error(f"[MESSAGES] Failed to save user msg: {e}")

        # 6. Se for HUMANO, parar
        if is_human_mode:
            logger.info("[WEBHOOK] 🛑 Human Requested - Stopping pipeline.")
            # Atualizar unread...
            return

        # 7. Fluxo IA
        # 🔥 BILLING: Verificar saldo antes de invocar IA
        from app.services.billing_service import get_billing_service
        billing_service = get_billing_service()

        if not billing_service.has_sufficient_balance(company_id):
            logger.info(f"[WEBHOOK] 💰 Insufficient balance for company {company_id} - skipping AI")
            # Enviar mensagem informativa ao usuário
            whatsapp_service.send_message(
                to_number=payload.phone,
                text="⚠️ Serviço temporariamente indisponível. Por favor, entre em contato com o suporte.",
                integration=integration
            )
            return

        logger.info(f"[WEBHOOK] Invoking AI Agent for company {company_id}...")
        langchain_service = LangChainService(settings.OPENAI_API_KEY, supabase)

        ai_response, metrics = await langchain_service.process_message(
            user_message=message_text,
            company_id=company_id,
            user_id=user_id,
            session_id=session_id,
            collect_metrics=True,
            channel="whatsapp",
            image_url=final_image_url,
            agent_id=agent_id,
        )

        # 8. Salvar Resposta IA
        try:
            await asyncio.to_thread(
                lambda: supabase.client.table("messages").insert({
                    "conversation_id": conversation_id,
                    "role": "assistant",
                    "content": ai_response,
                }).execute()
            )
            # LOG SANITIZADO
            logger.info("[WEBHOOK BACKGROUND] Agent response generated")
        except Exception as e:
            logger.error(f"[MESSAGES] Failed to save AI message: {e}")

        # 8.1 Atualizar preview
        try:
            preview_text = ai_response[:100] if len(ai_response) > 100 else ai_response
            # Get current unread
            res = await asyncio.to_thread(
                lambda: supabase.client.table("conversations").select("unread_count").eq("id", conversation_id).single().execute()
            )
            new_unread = (res.data.get("unread_count") or 0) + 1

            # FIX DE DATA ISO
            current_time_iso = datetime.now(timezone.utc).isoformat()

            await asyncio.to_thread(
                lambda: supabase.client.table("conversations").update({
                    "last_message_preview": preview_text,
                    "last_message_at": current_time_iso,
                    "unread_count": new_unread,
                }).eq("id", conversation_id).execute()
            )
        except Exception as e:
            logger.warning(f"[CONVERSATION] Metadata update error: {e}")

        # 9. Enviar no WhatsApp
        # LOG SANITIZADO
        logger.info(f"[WEBHOOK BACKGROUND] Sending response to {safe_phone}")
        success = whatsapp_service.send_message(
            to_number=payload.phone, text=ai_response, integration=integration
        )

        if success:
            logger.info(f"[WEBHOOK BACKGROUND] ✅ Message sent to {safe_phone}")
        else:
            logger.error("[WEBHOOK BACKGROUND] Failed to send WhatsApp message")

    except Exception as e:
        logger.error(f"[WEBHOOK BACKGROUND] Critical Error: {str(e)}", exc_info=True)


# ==============================================================================
# ROUTES
# ==============================================================================

@router.post("/api/v1/webhook/z-api")
@limiter.limit("120/minute")
async def z_api_webhook(request: Request, background_tasks: BackgroundTasks):
    """Webhook Z-API (Non-blocking)"""
    try:
        payload_dict = await request.json()
        logger.info(f"[WEBHOOK] Received from {payload_dict.get('connectedPhone')}")

        try:
            payload = ZAPIWebhookPayload(**payload_dict)
        except Exception:
            return {"status": "ignored", "reason": "invalid_payload"}

        if payload.isGroup or payload.fromMe:
            return {"status": "ignored"}

        if not payload.text and not payload.audio and not payload.image:
            return {"status": "ignored", "reason": "no_content"}

        # Buffer Logic
        if payload.text and payload.text.message:
            phone = payload.phone
            message_buffer_service.add_message(
                phone=phone,
                message=payload.text.message,
                company_id="pending",
                user_id="pending",
                integration={},
                payload=payload_dict,
            )
            logger.info(f"[WEBHOOK] Text from {phone} buffered")
            return {"status": "buffered", "phone": phone}

        elif payload.audio or payload.image:
            logger.info("[WEBHOOK] Dispatching media to background...")
            background_tasks.add_task(process_whatsapp_message_background, payload_dict)
            return {"status": "received", "type": "media"}

        return {"status": "ignored"}

    except Exception as e:
        logger.error(f"[WEBHOOK] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Server error") from e


@router.get("/api/v1/webhook/z-api/health")
async def webhook_health():
    """Health check endpoint para webhook"""
    return {
        "status": "healthy",
        "webhook": "z-api",
        "version": "1.0.0",
        "mode": "background_processing",
    }


@router.post("/api/webhook/send-message")
async def admin_send_message(
    payload: AdminSendMessagePayload,
    _: bool = Depends(require_master_admin)
):
    """Admin send message - requires logged in user"""
    try:
        logger.info(f"[ADMIN SEND] Sending to {payload.phone}")
        parts = payload.session_id.split(":")
        if len(parts) < 3:
            raise HTTPException(status_code=400, detail="Invalid session_id")

        company_id = parts[2]
        agent_id = parts[3] if len(parts) > 3 and parts[3] != "default" else None
        integration = integration_service.get_whatsapp_integration(company_id, agent_id)

        if not integration:
            raise HTTPException(status_code=404, detail="Integration not found")

        success = False
        if payload.message:
            success = whatsapp_service.send_message(payload.phone, payload.message, integration)
        elif payload.image_url:
            success = whatsapp_service.send_image(payload.phone, payload.image_url, "", integration)
        elif payload.audio_url:
            success = whatsapp_service.send_audio(payload.phone, payload.audio_url, integration)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to send")

        return {"status": "sent", "phone": payload.phone}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ADMIN SEND] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch("/api/conversations/{conversation_id}/status")
async def update_conversation_status(
    conversation_id: str,
    payload: StatusUpdatePayload,
    _: bool = Depends(require_master_admin)
):
    """Update status - requires admin API key (called via Next.js proxy)"""
    try:
        update_data = {"status": payload.status}
        if payload.status == "open":
            update_data["human_handoff_reason"] = None
        elif payload.status == "HUMAN_REQUESTED":
            update_data["human_handoff_reason"] = "Admin Intervention"

        await asyncio.to_thread(
            lambda: supabase.client.table("conversations")
            .update(update_data)
            .eq("id", conversation_id)
            .execute()
        )
        logger.info(f"[ADMIN] Status updated for {conversation_id}")
        return {"status": "success"}
    except Exception as e:
        logger.error(f"[ADMIN] Update status error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e

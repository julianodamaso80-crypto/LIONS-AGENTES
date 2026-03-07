"""
Chat API Endpoint - Multi-Tenant Secure
SIMPLIFICADO: Usa apenas LangChainService
Otimizado: Query única e Correção de Datas
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import UUID4, BaseModel, Field

from app.core import settings
from app.core.database import AsyncSupabaseClient, get_async_db, get_supabase_client
from app.core.rate_limit import limiter
from app.services import AudioService, LangChainService

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# WIDGET SECURITY HELPERS
# =============================================================================

from app.api.middleware.widget_security import (
    check_widget_rate_limit,
    validate_widget_domain,
)

# Serviços (lazy loading)
_langchain_service = None
_audio_service = None

def get_langchain_service():
    global _langchain_service
    if _langchain_service is None:
        _langchain_service = LangChainService(
            openai_api_key=settings.OPENAI_API_KEY,
            supabase_client=get_supabase_client(),
        )
    return _langchain_service

def get_audio_service():
    global _audio_service
    if _audio_service is None:
        _audio_service = AudioService(openai_api_key=settings.OPENAI_API_KEY)
    return _audio_service


class ChatRequest(BaseModel):
    chatInput: Optional[str] = Field(None, description="Mensagem do usuário")
    audioData: Optional[str] = Field(None, description="Áudio em base64")
    imageUrl: Optional[str] = Field(None, description="URL pública da imagem enviada")
    sessionId: UUID4 = Field(..., description="ID da sessão")
    companyId: UUID4 = Field(..., description="ID da empresa")
    userId: Optional[UUID4] = Field(None, description="ID do usuário")
    agentId: Optional[UUID4] = Field(None, description="ID do agente específico")
    assistantMessageId: Optional[UUID4] = Field(None, description="ID pré-gerado")
    channel: str = Field(default="web", description="Origin: web, whatsapp, widget")
    conversationHistory: Optional[List[Dict[str, Any]]] = None
    options: Optional[Dict[str, bool]] = Field(None)

class ChatResponse(BaseModel):
    output: str = Field(..., description="Resposta da IA")
    companyId: str
    sessionId: str


class DeleteSessionRequest(BaseModel):
    """Request to delete an expired session's memory."""
    sessionId: str = Field(..., description="Session ID to delete")
    companyId: str = Field(..., description="Company ID for thread_id composition")


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("100/minute")
async def chat_endpoint(
    request: Request,
    chat_request: ChatRequest,
    db: AsyncSupabaseClient = Depends(get_async_db),
) -> ChatResponse:
    try:
        if not chat_request.chatInput and not chat_request.audioData and not chat_request.imageUrl:
            raise HTTPException(status_code=400, detail="No content provided")

        logger.info(f"[CHAT] Request: company={chat_request.companyId}, session={chat_request.sessionId}")

        # Transcrever áudio
        user_message = chat_request.chatInput
        if chat_request.audioData:
            try:
                user_message = get_audio_service().transcribe_audio(
                    chat_request.audioData,
                    company_id=str(chat_request.companyId),
                    agent_id=str(chat_request.agentId) if chat_request.agentId else None
                )
                # LOG SANITIZADO
                logger.info(f"[AUDIO] Transcribed (len={len(user_message)})")
            except Exception as e:
                logger.error(f"[AUDIO] Transcription failed: {e}")
                raise HTTPException(status_code=400, detail="Audio transcription failed") from e

        # ==============================================================================
        # OTIMIZAÇÃO: Query Única para Status e Dados da Conversa
        # ==============================================================================
        conv_check = (
            await db.client.table("conversations")
            .select("id, status, unread_count, company_id") # Pega tudo que precisa
            .eq("session_id", str(chat_request.sessionId))
            .limit(1)
            .execute()
        )

        conversation_id = None
        current_unread = 0
        existing_company_id = None
        conv_status = "open"

        if conv_check and conv_check.data and len(conv_check.data) > 0:
            data = conv_check.data[0]
            conversation_id = data.get("id")
            conv_status = data.get("status")
            current_unread = data.get("unread_count") or 0
            existing_company_id = data.get("company_id")

        # ==============================================================================
        # HUMAN HANDOFF CHECK
        # ==============================================================================
        if conv_status == "HUMAN_REQUESTED":
            logger.info("[CHAT] 🚫 Modo HUMANO - Agente pausado")

            if user_message and conversation_id:
                # Salvar mensagem do usuário
                await db.client.table("messages").insert({
                    "conversation_id": conversation_id,
                    "role": "user",
                    "content": user_message,
                    "type": "text",
                }).execute()

                # Atualizar conversa
                await (
                    db.client.table("conversations")
                    .update({
                        "last_message_preview": (user_message or "")[:100],
                        "last_message_at": datetime.utcnow().isoformat() + "Z", # DATA CORRETA
                        "unread_count": current_unread + 1,
                    })
                    .eq("id", conversation_id)
                    .execute()
                )
            return ChatResponse(output="", companyId=str(chat_request.companyId), sessionId=str(chat_request.sessionId))

        # ==============================================================================
        # BALANCE CHECK (Paywall)
        # ==============================================================================
        from app.services.billing_service import get_billing_service
        billing_service = get_billing_service()

        if not billing_service.has_sufficient_balance(str(chat_request.companyId)):
            logger.info(f"[CHAT] 💰 Insufficient balance for company {chat_request.companyId}")
            # Return empty response (not error) to avoid "connection error" in frontend
            return ChatResponse(output="", companyId=str(chat_request.companyId), sessionId=str(chat_request.sessionId))

        # ==============================================================================
        # PROCESSAMENTO LANGCHAIN
        # ==============================================================================
        try:
            response_text, metrics = await get_langchain_service().process_message(
                user_message=user_message or "",
                company_id=str(chat_request.companyId),
                user_id=str(chat_request.userId) if chat_request.userId else None,
                session_id=str(chat_request.sessionId),
                conversation_history=chat_request.conversationHistory,
                options=chat_request.options,
                image_url=chat_request.imageUrl,
                agent_id=str(chat_request.agentId) if chat_request.agentId else None,
                async_supabase_client=db.client,
            )
        except ValueError as e:
            # ✅ VALIDATION: Check if it's an agent configuration error
            error_msg = str(e)
            if "CONFIG_REQUIRED" in error_msg or "No active agents" in error_msg or "Agente de IA" in error_msg:
                logger.warning(f"[CHAT] Agent validation failed: {error_msg}")
                return ChatResponse(
                    output="⚠️ Nenhum agente configurado. Configure um agente em Configurações.",
                    companyId=str(chat_request.companyId),
                    sessionId=str(chat_request.sessionId)
                )
            # Re-raise if it's a different ValueError
            raise

        # ==============================================================================
        # PERSISTÊNCIA E ATUALIZAÇÃO (Usando dados já carregados)
        # ==============================================================================
        try:
            needs_company_update = False

            # Se conversa existe (carregada lá em cima)
            if conversation_id:
                if existing_company_id is None:
                    needs_company_update = True
                    logger.info(f"[CHAT] Updating null company_id for {conversation_id}")
            else:
                # CRIAR NOVA CONVERSA
                logger.info(f"[CHAT] Creating new conversation for session {chat_request.sessionId}")
                try:
                    new_conv = {
                        "company_id": str(chat_request.companyId),
                        "user_id": str(chat_request.userId) if chat_request.userId else None,
                        "session_id": str(chat_request.sessionId),
                        "agent_id": str(chat_request.agentId) if chat_request.agentId else None,
                        "channel": chat_request.channel or "web",
                        "status": "open",
                        "unread_count": 1,
                        "last_message_preview": (response_text[:100] if response_text else "Nova conversa"),
                        "last_message_at": datetime.utcnow().isoformat() + "Z", # DATA CORRETA
                    }
                    insert_res = await db.client.table("conversations").insert(new_conv).execute()

                    if insert_res.data:
                        conversation_id = insert_res.data[0]["id"]

                except Exception as insert_error:
                    # Retry para race condition
                    if "23505" in str(insert_error) or "duplicate key" in str(insert_error):
                        retry = await db.client.table("conversations").select("id, unread_count").eq("session_id", str(chat_request.sessionId)).single().execute()
                        if retry.data:
                            conversation_id = retry.data["id"]
                            current_unread = retry.data.get("unread_count") or 0

            # UPDATE FINAL
            if conversation_id:
                preview = response_text[:100] if response_text else "Nova mensagem"
                update_data = {
                    "last_message_preview": preview,
                    "last_message_at": datetime.utcnow().isoformat() + "Z", # DATA CORRETA
                    "unread_count": current_unread + 1,
                }
                if needs_company_update:
                    update_data["company_id"] = str(chat_request.companyId)

                await db.client.table("conversations").update(update_data).eq("id", conversation_id).execute()

                # SALVAR MENSAGENS
                if user_message:
                    await db.client.table("messages").insert({
                        "conversation_id": conversation_id,
                        "role": "user",
                        "content": user_message,
                        "type": "text",
                    }).execute()

                if response_text:
                    await db.client.table("messages").insert({
                        "conversation_id": conversation_id,
                        "role": "assistant",
                        "content": response_text,
                        "type": "text",
                    }).execute()

        except Exception as e:
            logger.error(f"[CHAT] Database update failed: {e}", exc_info=True)

        return ChatResponse(
            output=response_text,
            companyId=str(chat_request.companyId),
            sessionId=str(chat_request.sessionId),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ERROR] {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error") from e

# ==============================================================================
# STREAMING ENDPOINT (P/ Realtime) - Com as mesmas correções de data
# ==============================================================================

@router.post("/chat/stream")
@limiter.limit("100/minute")
async def chat_stream(
    request: Request,
    chat_request: ChatRequest,
    db: AsyncSupabaseClient = Depends(get_async_db),
):
    """
    Streaming chat endpoint using Server-Sent Events (SSE).
    """
    # Validation
    if not chat_request.chatInput:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="chatInput is required for streaming",
        )

    logger.info(
        f"[STREAM] Request from company={chat_request.companyId}, session={chat_request.sessionId}"
    )

    # Check HUMAN_REQUESTED status
    conv_check = (
        await db.client.table("conversations")
        .select("id, status, unread_count")
        .eq("session_id", str(chat_request.sessionId))
        .limit(1)
        .execute()
    )

    conversation_id = None
    current_unread = 0

    if conv_check and conv_check.data and len(conv_check.data) > 0:
        conv_status = conv_check.data[0].get("status")
        conversation_id = conv_check.data[0].get("id")
        current_unread = conv_check.data[0].get("unread_count") or 0

        if conv_status == "HUMAN_REQUESTED":
            logger.info("[STREAM] 🚫 Conversa em modo HUMANO - não streamar")

            async def human_mode_response():
                yield "data: [HUMAN_MODE]\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(
                human_mode_response(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

    # ===========================================================================
    # BALANCE CHECK (Paywall)
    # ===========================================================================
    from app.services.billing_service import get_billing_service
    billing_service = get_billing_service()

    if not billing_service.has_sufficient_balance(str(chat_request.companyId)):
        logger.info(f"[STREAM] 💰 Insufficient balance for company {chat_request.companyId}")

        async def no_balance_response():
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            no_balance_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Get company config and prepare graph
    from app.agents.graph import stream_agent
    from app.services.agent_service import AgentService
    from app.services.langchain_service import get_or_create_graph

    sync_db = get_supabase_client()

    # Get company config
    company_response = (
        await db.client.table("companies")
        .select("*")
        .eq("id", str(chat_request.companyId))
        .limit(1)
        .execute()
    )

    if not company_response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )

    company_config = company_response.data[0]

    # Get agent if specified
    agent_data = None
    api_key = settings.OPENAI_API_KEY

    # ✅ VALIDATION: Agent ID is mandatory
    if not chat_request.agentId:
        logger.warning(f"[STREAM] No agentId provided for company {chat_request.companyId}")

        async def no_agent_configured():
            data = json.dumps({"token": "⚠️ Nenhum agente configurado. Configure um agente em Configurações."})
            yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            no_agent_configured(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Try to load agent
    try:
        agent_service = AgentService()
        agent_obj = agent_service.get_agent_by_id(str(chat_request.agentId))
        if agent_obj:
            agent_data = agent_obj.model_dump()
            # Use agent's API key if available (decrypted)
            if agent_data.get("llm_api_key"):
                api_key = agent_data["llm_api_key"]
        else:
            # Agent not found
            logger.warning(f"[STREAM] Agent {chat_request.agentId} not found")

            async def agent_not_found():
                data = json.dumps({"token": "⚠️ Agente não encontrado. Verifique a configuração."})
                yield f"data: {data}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(
                agent_not_found(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
    except Exception as e:
        logger.error(f"[STREAM] Error loading agent: {e}")

    # ===========================================================================
    # WIDGET SECURITY: Domain Validation + Rate Limiting
    # ===========================================================================
    if agent_data and not chat_request.userId:
        # This is likely a widget request (anonymous user)
        try:
            # 1. Validate domain whitelist
            await validate_widget_domain(request, agent_data, db)

            # 2. Rate limit by session_id (50 requests/hour default)
            await check_widget_rate_limit(
                db=db,
                identifier=str(chat_request.sessionId),
                agent_id=str(chat_request.agentId),
                max_requests=50,
                window_minutes=60
            )
            logger.info(f"[STREAM] Widget security checks passed for session {chat_request.sessionId}")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"[STREAM] Widget security check error (allowing): {e}")

    # 🔥 Usar cache de grafos (LRUCache) para evitar recriação a cada mensagem
    from app.services.qdrant_service import get_qdrant_service
    qdrant = get_qdrant_service()

    # agent_data contém updated_at que é usado como chave do cache
    # ✅ FIXED: agentId is now guaranteed to exist
    graph = await get_or_create_graph(
        company_id=str(chat_request.companyId),
        agent_id=str(chat_request.agentId),
        agent_config=agent_data,
        api_key=api_key,
        qdrant_service=qdrant,
        supabase_client=sync_db,
        enable_logging=True,
    )

    # === VISION PROCESSING (antes do streaming) ===
    import os

    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    enriched_message = chat_request.chatInput

    if chat_request.imageUrl and agent_data:
        v_model = agent_data.get("vision_model")

        # Seleção de chave baseada no modelo de Vision
        v_key = None
        if v_model:
            if v_model == "gpt-4o" or v_model.startswith("gpt-"):
                v_key = os.getenv("OPENAI_API_KEY")
            elif v_model.startswith("claude"):
                v_key = os.getenv("ANTHROPIC_API_KEY")
            elif v_model.startswith("gemini"):
                v_key = os.getenv("GOOGLE_API_KEY")

        if v_model and v_key:
            try:
                # Callback para registrar custos de Vision
                from app.core.callbacks.cost_callback import CostCallbackHandler
                vision_callbacks = [
                    CostCallbackHandler(
                        service_type="vision",
                        company_id=str(chat_request.companyId),
                        agent_id=str(chat_request.agentId) if chat_request.agentId else None,
                        model_name=v_model
                    )
                ]

                # Análise de imagem síncrona (antes do stream)
                if v_model == "gpt-4o" or v_model.startswith("gpt-"):
                    vision_llm = ChatOpenAI(
                        model=v_model,
                        api_key=v_key,
                        temperature=0.3,
                        callbacks=vision_callbacks
                    )
                elif v_model.startswith("claude"):
                    vision_llm = ChatAnthropic(
                        model=v_model,
                        api_key=v_key,
                        temperature=0.3,
                        callbacks=vision_callbacks
                    )
                else:
                    vision_llm = None

                if vision_llm:
                    vision_messages = [
                        SystemMessage(content="Descreva tecnicamente a imagem para um Agente de Suporte. Seja breve."),
                        HumanMessage(content=[
                            {"type": "text", "text": "Descreva:"},
                            {"type": "image_url", "image_url": {"url": chat_request.imageUrl}},
                        ]),
                    ]
                    vision_response = vision_llm.invoke(vision_messages)
                    enriched_message = f"{chat_request.chatInput}\n\n[CONTEXTO VISUAL]:\n{vision_response.content}"
                    logger.info(f"[STREAM VISION] ✅ Imagem analisada com {v_model}")
            except Exception as e:
                logger.error(f"[STREAM VISION] ❌ Erro: {e}")
        elif chat_request.imageUrl and not v_model:
            logger.warning("[STREAM VISION] ⚠️ vision_model não configurado no agente")

    # ===========================================================================
    # 🛡️ GUARDRAILS SECURITY CHECK (BEFORE STREAMING)
    # ===========================================================================
    from app.agents.guardrails import ScaleGuardrail

    final_message = enriched_message
    guardrail = None

    if agent_data:
        try:
            guardrail = ScaleGuardrail(
                agent_config=agent_data,
                company_id=str(chat_request.companyId)
            )
            is_blocked, block_reason, sanitized_text = await guardrail.validate_input(enriched_message)

            if is_blocked:
                logger.warning("[SECURITY] 🛡️ Stream message BLOCKED")

                async def blocked_response():
                    data = json.dumps({"token": block_reason, "blocked": True})
                    yield f"data: {data}\n\n"
                    yield "data: [DONE]\n\n"

                return StreamingResponse(
                    blocked_response(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        "X-Accel-Buffering": "no",
                    },
                )

            # 🔥 Usa texto sanitizado
            final_message = sanitized_text
            logger.debug("[SECURITY] ✅ Stream message passed guardrail")

        except Exception as gr_error:
            logger.error(f"[SECURITY] ⚠️ Guardrail error: {gr_error}", exc_info=True)

            # 🔥 Fail-close se configurado (default: True)
            fail_close = getattr(guardrail, 'fail_close', True) if guardrail else True
            if fail_close:
                async def error_response():
                    data = json.dumps({"token": "Erro temporário de segurança. Por favor, tente novamente.", "blocked": True})
                    yield f"data: {data}\n\n"
                    yield "data: [DONE]\n\n"

                return StreamingResponse(
                    error_response(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        "X-Accel-Buffering": "no",
                    },
                )

    async def event_generator():
        """Generate SSE events with tokens from the LLM stream."""
        full_response = ""

        try:
            async for token in stream_agent(
                graph=graph,
                user_message=final_message,  # 🔥 Usa texto sanitizado
                company_id=str(chat_request.companyId),
                user_id=str(chat_request.userId) if chat_request.userId else None,
                session_id=str(chat_request.sessionId),
                company_config=company_config,
                options=chat_request.options,
                supabase_client=sync_db,
                agent_id=str(chat_request.agentId) if chat_request.agentId else None,
                async_supabase_client=db.client,
            ):
                full_response += token
                # Format as SSE
                data = json.dumps({"token": token})
                yield f"data: {data}\n\n"

            # === PERSIST MESSAGE AFTER STREAMING ===
            if full_response.strip():
                try:
                    # Get or create conversation
                    nonlocal conversation_id, current_unread

                    if not conversation_id:
                        # Create conversation
                        new_conv = (
                            await db.client.table("conversations")
                            .insert({
                                "company_id": str(chat_request.companyId),
                                "user_id": str(chat_request.userId) if chat_request.userId else None,
                                "session_id": str(chat_request.sessionId),
                                "agent_id": str(chat_request.agentId) if chat_request.agentId else None,
                                "channel": chat_request.channel or "web",
                                "status": "open",
                                "unread_count": 1,
                                "last_message_preview": full_response[:100],
                                "last_message_at": datetime.utcnow().isoformat() + "Z", # FIX DATA ISO
                            })
                            .execute()
                        )
                        if new_conv.data:
                            conversation_id = new_conv.data[0]["id"]

                    # Save assistant message
                    if conversation_id:
                        message_data = {
                            "conversation_id": conversation_id,
                            "role": "assistant",
                            "content": full_response,
                            "type": "text",
                        }

                        # Use frontend ID to prevent duplicates from Realtime
                        if chat_request.assistantMessageId:
                            message_data["id"] = str(chat_request.assistantMessageId)

                        await db.client.table("messages").insert(message_data).execute()

                        # Update conversation metadata
                        await db.client.table("conversations").update({
                            "last_message_preview": full_response[:100],
                            "last_message_at": datetime.utcnow().isoformat() + "Z", # FIX DATA ISO
                            "unread_count": current_unread + 1,
                        }).eq("id", conversation_id).execute()

                        logger.info(f"[STREAM] Message persisted to conversation {conversation_id}")

                except Exception as e:
                    logger.error(f"[STREAM] Error persisting message: {e}")

        except Exception as e:
            logger.error(f"[STREAM] Error in stream: {e}", exc_info=True)
            error_data = json.dumps({"error": str(e)})
            yield f"data: {error_data}\n\n"

        # Signal end of stream
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# =============================================================================
# SESSION TTL - DELETE EXPIRED SESSION MEMORY
# =============================================================================

@router.delete("/session")
async def delete_session(request: DeleteSessionRequest):
    """
    Delete LangGraph checkpoints for an expired session.
    
    Called by the widget frontend when session TTL (24h) expires.
    This cleans up both the working memory (checkpoints) to prevent
    the AI from "remembering" old conversations.
    
    Args:
        request: DeleteSessionRequest with sessionId and companyId
    
    Returns:
        {"success": True} on success, error details on failure
    """
    try:
        from app.services.memory_service import MemoryService

        # Compose thread_id in LangGraph format
        thread_id = f"{request.companyId}:{request.sessionId}"

        logger.info(f"[Session TTL] Deleting expired session: {thread_id}")

        # Use MemoryService to clean up checkpoints
        memory_service = MemoryService(supabase_client=get_supabase_client().client)
        success = await memory_service.clear_session_memory(thread_id)

        if success:
            return {"success": True, "message": "Session memory cleared"}
        else:
            return {"success": False, "message": "Failed to clear session memory"}

    except Exception as e:
        logger.error(f"[Session TTL] Error deleting session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting session: {str(e)}"
        ) from e

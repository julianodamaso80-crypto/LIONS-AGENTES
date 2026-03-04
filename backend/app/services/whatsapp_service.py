"""
Serviço WhatsApp - Integração com Z-API
"""

import logging
from typing import Any, Dict, Optional

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)


class WhatsappService:
    """Serviço para comunicação com Z-API (WhatsApp)"""

    def __init__(self):
        """Inicializa o serviço WhatsApp"""
        logger.info("WhatsApp service initialized")

    def send_message(
        self, to_number: str, text: str, integration: Dict[str, Any]
    ) -> bool:
        """
        Envia mensagem de texto via Z-API

        Args:
            to_number: Número do destinatário (ex: 5544999999999)
            text: Texto da mensagem
            integration: Dict com configurações da integração (token, instance_id, base_url)

        Returns:
            True se enviado com sucesso

        Raises:
            Exception: Se houver erro no envio
        """
        try:
            base_url = integration.get("base_url", "https://api.z-api.io/instances")
            instance_id = integration.get("instance_id")
            token = integration.get("token")

            if not instance_id or not token:
                raise ValueError("Missing instance_id or token in integration config")

            # URL da Z-API para envio de texto
            url = f"{base_url}/{instance_id}/token/{token}/send-text"

            # Payload esperado pela Z-API
            payload = {"phone": to_number, "message": text}

            safe_phone = f"...{str(to_number)[-4:]}" if to_number else "Unknown"

            # Headers - adicionar Client-Token se configurado
            headers = {"Content-Type": "application/json"}
            if integration.get("client_token"):
                headers["Client-Token"] = integration["client_token"]
                logger.debug("[WHATSAPP] Using Client-Token header")

            logger.info(f"[WHATSAPP] Sending message to {safe_phone} via Z-API")
            logger.debug(f"[WHATSAPP] URL: {url}")
            logger.debug(f"[WHATSAPP] Message preview len: {len(text)}")

            # 🧪 DRY_RUN MODE: Simula envio sem chamar Z-API
            if settings.DRY_RUN:
                logger.info(f"[WHATSAPP] 🧪 DRY_RUN: Simulando envio para {safe_phone}")
                return True

            # Enviar POST para Z-API
            response = requests.post(url, json=payload, headers=headers, timeout=30)

            # SE ACONTECER ERRO, PEGAMOS O CORPO DA RESPOSTA
            if response.status_code != 200:
                logger.error(
                    f"[WHATSAPP] HTTP {response.status_code} error: {response.text[:200]}"
                )

            response.raise_for_status()

            logger.info(f"[WHATSAPP] ✅ Message sent successfully to {safe_phone}")
            # logger.debug(f"[WHATSAPP] Z-API Response: {response.json()}") # Avoid logging raw response if sensitive

            return True

        except requests.exceptions.HTTPError as e:
            logger.error(f"[WHATSAPP] HTTP error sending message: {str(e)}")
            if "response" in locals() and response is not None:
                logger.debug(f"[WHATSAPP] Response Body: {response.text[:200]}")
            raise Exception("Failed to send WhatsApp message") from e
        except requests.exceptions.RequestException as e:
            logger.error(f"[WHATSAPP] Error sending message via Z-API: {str(e)}")
            raise Exception("Failed to send WhatsApp message") from e
        except Exception as e:
            logger.error(f"[WHATSAPP] Unexpected error: {str(e)}")
            raise Exception(f"Unexpected error: {str(e)}") from e
            raise

    def send_audio(
        self, to_number: str, audio_url: str, integration: Dict[str, any]
    ) -> bool:
        """
        Envia áudio via Z-API

        Args:
            to_number: Número do destinatário
            audio_url: URL do áudio
            integration: Dict com configurações da integração

        Returns:
            True se enviado com sucesso
        """
        try:
            base_url = integration.get("base_url", "https://api.z-api.io/instances")
            instance_id = integration.get("instance_id")
            token = integration.get("token")

            if not instance_id or not token:
                raise ValueError("Missing instance_id or token in integration config")

            # URL da Z-API para envio de áudio
            url = f"{base_url}/{instance_id}/token/{token}/send-audio"

            payload = {"phone": to_number, "audio": audio_url}

            headers = {"Content-Type": "application/json"}
            if integration.get("client_token"):
                headers["Client-Token"] = integration["client_token"]

            safe_phone = f"...{str(to_number)[-4:]}"
            logger.info(f"[WHATSAPP] Sending audio to {safe_phone}")

            # 🧪 DRY_RUN MODE
            if settings.DRY_RUN:
                logger.info(f"[WHATSAPP] 🧪 DRY_RUN: Simulando envio de áudio para {safe_phone}")
                return True

            response = requests.post(url, json=payload, headers=headers, timeout=30)

            if response.status_code != 200:
                logger.error(
                    f"[WHATSAPP] Audio HTTP {response.status_code}: {response.text[:200]}"
                )

            response.raise_for_status()
            logger.info(f"[WHATSAPP] ✅ Audio sent successfully to {safe_phone}")
            return True

        except Exception as e:
            logger.error(f"[WHATSAPP] Error sending audio: {str(e)}")
            return False

    def send_image(
        self, to_number: str, image_url: str, caption: str, integration: Dict[str, any]
    ) -> bool:
        """
        Envia imagem via Z-API

        Args:
            to_number: Número do destinatário
            image_url: URL da imagem
            caption: Legenda da imagem
            integration: Dict com configurações da integração

        Returns:
            True se enviado com sucesso
        """
        try:
            base_url = integration.get("base_url", "https://api.z-api.io/instances")
            instance_id = integration.get("instance_id")
            token = integration.get("token")

            if not instance_id or not token:
                raise ValueError("Missing instance_id or token in integration config")

            # URL da Z-API para envio de imagem
            url = f"{base_url}/{instance_id}/token/{token}/send-image"

            payload = {"phone": to_number, "image": image_url, "caption": caption or ""}

            headers = {"Content-Type": "application/json"}
            if integration.get("client_token"):
                headers["Client-Token"] = integration["client_token"]

            safe_phone = f"...{str(to_number)[-4:]}"
            logger.info(f"[WHATSAPP] Sending image to {safe_phone}")

            # 🧪 DRY_RUN MODE
            if settings.DRY_RUN:
                logger.info(f"[WHATSAPP] 🧪 DRY_RUN: Simulando envio de imagem para {safe_phone}")
                return True

            response = requests.post(url, json=payload, headers=headers, timeout=30)

            if response.status_code != 200:
                logger.error(
                    f"[WHATSAPP] Image HTTP {response.status_code}: {response.text[:200]}"
                )

            response.raise_for_status()
            logger.info(f"[WHATSAPP] ✅ Image sent successfully to {safe_phone}")
            return True

        except Exception as e:
            logger.error(f"[WHATSAPP] Error sending image: {str(e)}")
            return False


# Singleton instance
_whatsapp_service: Optional[WhatsappService] = None


def get_whatsapp_service() -> WhatsappService:
    """
    Retorna instância singleton do WhatsappService

    Returns:
        WhatsappService instance
    """
    global _whatsapp_service

    if _whatsapp_service is None:
        _whatsapp_service = WhatsappService()

    return _whatsapp_service

"""
Serviço de Áudio - Whisper API da OpenAI
"""

import base64
import logging
import os
import tempfile

from openai import OpenAI

logger = logging.getLogger(__name__)


class AudioService:
    """Serviço para transcrever áudio usando Whisper API"""

    def __init__(self, openai_api_key: str):
        """
        Inicializa o serviço de áudio

        Args:
            openai_api_key: API key da OpenAI
        """
        self.client = OpenAI(api_key=openai_api_key)
        logger.info("Audio service initialized with Whisper API")

    def transcribe_audio(
        self,
        audio_base64: str,
        company_id: str = None,
        agent_id: str = None
    ) -> str:
        """
        Transcreve áudio em base64 usando Whisper API

        Args:
            audio_base64: Áudio em formato base64
            company_id: ID da empresa (para billing)
            agent_id: ID do agente (para billing)

        Returns:
            Texto transcrito

        Raises:
            ValueError: Se o áudio estiver vazio ou inválido
            Exception: Se houver erro na transcrição
        """
        try:
            if not audio_base64:
                raise ValueError("Audio data is empty")

            logger.info("[AUDIO] Starting audio transcription")

            # Decodificar base64
            audio_bytes = base64.b64decode(audio_base64)
            logger.info(f"[AUDIO] Decoded audio size: {len(audio_bytes)} bytes")

            # Criar arquivo temporário para o áudio
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as temp_file:
                temp_file.write(audio_bytes)
                temp_file_path = temp_file.name

            try:
                # Transcrever usando Whisper API with verbose output for duration
                logger.info(f"[AUDIO] Sending to Whisper API: {temp_file_path}")

                with open(temp_file_path, "rb") as audio_file:
                    transcript = self.client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        language="pt",  # Português
                        response_format="verbose_json",  # Get duration
                    )

                transcribed_text = transcript.text

                # Track cost based on duration
                try:
                    duration_seconds = getattr(transcript, "duration", None)
                    if duration_seconds:
                        from .usage_service import get_usage_service

                        usage_service = get_usage_service()
                        usage_service.track_cost_sync(
                            service_type="audio",
                            model="whisper-1",
                            input_tokens=int(
                                duration_seconds
                            ),  # seconds stored as "tokens"
                            output_tokens=0,
                            company_id=company_id,  # NOVO: Passa company_id
                            agent_id=agent_id,      # NOVO: Passa agent_id
                            details={"duration_seconds": duration_seconds},
                        )
                except Exception as e:
                    logger.warning(f"[AUDIO] Cost tracking failed: {e}")

                logger.info(
                    f"[AUDIO] Transcription successful: {transcribed_text[:100]}..."
                )

                return transcribed_text

            finally:
                # Deletar arquivo temporário
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
                    logger.debug(f"[AUDIO] Temporary file deleted: {temp_file_path}")

        except ValueError as e:
            logger.error(f"[AUDIO] Validation error: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"[AUDIO] Transcription error: {str(e)}", exc_info=True)
            raise Exception(f"Failed to transcribe audio: {str(e)}") from e

    def transcribe_audio_from_url(
        self,
        audio_url: str,
        company_id: str = None,
        agent_id: str = None
    ) -> str:
        """
        Transcreve áudio a partir de URL (usado para WhatsApp)

        Args:
            audio_url: URL do áudio
            company_id: ID da empresa (para billing)
            agent_id: ID do agente (para billing)

        Returns:
            Texto transcrito

        Raises:
            ValueError: Se a URL estiver vazia ou inválida
            Exception: Se houver erro no download ou transcrição
        """
        try:
            if not audio_url:
                raise ValueError("Audio URL is empty")

            logger.info(f"[AUDIO] Downloading audio from URL: {audio_url[:100]}...")

            # Importar requests aqui para evitar dependência desnecessária
            import requests

            # Download do áudio
            response = requests.get(audio_url, timeout=30)
            response.raise_for_status()

            audio_bytes = response.content
            logger.info(f"[AUDIO] Downloaded audio size: {len(audio_bytes)} bytes")

            # Detectar extensão do arquivo pela URL ou Content-Type
            content_type = response.headers.get("Content-Type", "")

            # Mapear content-type para extensão
            extension_map = {
                "audio/ogg": ".ogg",
                "audio/mpeg": ".mp3",
                "audio/mp4": ".m4a",
                "audio/wav": ".wav",
                "audio/webm": ".webm",
            }

            extension = extension_map.get(
                content_type, ".ogg"
            )  # Default .ogg para WhatsApp

            logger.info(f"[AUDIO] Detected format: {content_type} -> {extension}")

            # Criar arquivo temporário
            with tempfile.NamedTemporaryFile(
                suffix=extension, delete=False
            ) as temp_file:
                temp_file.write(audio_bytes)
                temp_file_path = temp_file.name

            try:
                # Transcrever usando Whisper API
                logger.info(f"[AUDIO] Sending to Whisper API: {temp_file_path}")

                with open(temp_file_path, "rb") as audio_file:
                    transcript = self.client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        language="pt",  # Português
                    )

                transcribed_text = transcript.text

                # 🔥 BILLING: Track cost based on duration (igual ao transcribe_audio)
                try:
                    duration_seconds = getattr(transcript, "duration", None)
                    if duration_seconds and company_id:
                        from .usage_service import get_usage_service

                        usage_service = get_usage_service()
                        usage_service.track_cost_sync(
                            service_type="audio",
                            model="whisper-1",
                            input_tokens=int(duration_seconds),  # seconds as tokens
                            output_tokens=0,
                            company_id=company_id,
                            agent_id=agent_id,
                            details={"duration_seconds": duration_seconds, "source": "whatsapp"},
                        )
                        logger.info(f"[AUDIO] Billing tracked: {duration_seconds}s for company {company_id}")
                except Exception as e:
                    logger.warning(f"[AUDIO] Cost tracking failed: {e}")

                logger.info(
                    f"[AUDIO] Transcription successful: {transcribed_text[:100]}..."
                )

                return transcribed_text

            finally:
                # Deletar arquivo temporário
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
                    logger.debug(f"[AUDIO] Temporary file deleted: {temp_file_path}")

        except requests.exceptions.RequestException as e:
            logger.error(f"[AUDIO] Error downloading audio: {str(e)}")
            raise Exception(f"Failed to download audio from URL: {str(e)}") from e
        except ValueError as e:
            logger.error(f"[AUDIO] Validation error: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"[AUDIO] Transcription error: {str(e)}", exc_info=True)
            raise Exception(f"Failed to transcribe audio from URL: {str(e)}") from e

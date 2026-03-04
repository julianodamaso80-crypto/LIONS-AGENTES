"""
Message Buffer Service for WhatsApp message aggregation.

Implements debounce pattern to combine consecutive user messages
before processing with LLM, reducing API calls and improving response coherence.
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.redis import get_redis_client

logger = logging.getLogger(__name__)


class MessageBufferService:
    """
    Manages message buffering in Redis with debounce logic.

    Aggregates consecutive WhatsApp messages from the same user,
    waiting for a pause (debounce) or maximum wait time before processing.
    """

    def __init__(self):
        self.redis = get_redis_client()

    def _get_key(self, phone: str) -> str:
        """Generate Redis key for phone number."""
        return f"whatsapp_buffer:{phone}"

    def add_message(
        self,
        phone: str,
        message: str,
        company_id: str,
        user_id: str,
        integration: Dict,
        payload: Dict,
    ) -> bool:
        """
        Add message to buffer.

        Args:
            phone: User phone number (buffer key)
            message: Message text
            company_id: Company ID (can be "pending" if not resolved yet)
            user_id: User ID (can be "pending" if not resolved yet)
            integration: Integration config dict
            payload: Full webhook payload

        Returns:
            True if this is the first message in buffer (new buffer created)
        """
        key = self._get_key(phone)
        now_iso = datetime.now().isoformat()

        # Try to get existing buffer
        raw_data = self.redis.get(key)

        if raw_data:
            # Append to existing buffer
            data = json.loads(raw_data)
            data["messages"].append(message)
            data["last_at"] = now_iso
            data["payload"] = payload  # Update to latest payload
            is_first = False
        else:
            # Create new buffer
            data = {
                "messages": [message],
                "first_at": now_iso,
                "last_at": now_iso,
                "company_id": company_id,
                "user_id": user_id,
                "integration": integration,
                "payload": payload,
            }
            is_first = True

        # Save with TTL (safety net against orphaned buffers)
        self.redis.setex(key, settings.BUFFER_TTL_SECONDS, json.dumps(data))

        msg_count = len(data["messages"])
        logger.debug(f"[BUFFER] Added message for {phone}. Count: {msg_count}")
        return is_first

    def should_process(self, phone: str) -> bool:
        """
        Check if buffer should be processed (debounce or max wait reached).

        Rules:
        1. Debounce: User stopped typing (>= BUFFER_DEBOUNCE_SECONDS since last)
        2. Max Wait: User typing too long (>= BUFFER_MAX_WAIT_SECONDS since first)

        Args:
            phone: User phone number

        Returns:
            True if buffer should be processed now
        """
        key = self._get_key(phone)
        raw_data = self.redis.get(key)

        if not raw_data:
            return False

        data = json.loads(raw_data)

        now = datetime.now()
        first_at = datetime.fromisoformat(data["first_at"])
        last_at = datetime.fromisoformat(data["last_at"])

        # Calculate elapsed times
        seconds_since_last = (now - last_at).total_seconds()
        seconds_since_first = (now - first_at).total_seconds()

        # Rule 1: Debounce (user stopped typing?)
        if seconds_since_last >= settings.BUFFER_DEBOUNCE_SECONDS:
            logger.info(
                f"[BUFFER] Trigger DEBOUNCE for {phone} "
                f"({seconds_since_last:.1f}s idle, "
                f"{len(data['messages'])} msgs buffered)"
            )
            return True

        # Rule 2: Max Wait (user typing for too long?)
        if seconds_since_first >= settings.BUFFER_MAX_WAIT_SECONDS:
            logger.info(
                f"[BUFFER] Trigger MAX_WAIT for {phone} "
                f"({seconds_since_first:.1f}s duration, "
                f"{len(data['messages'])} msgs buffered)"
            )
            return True

        return False

    def get_and_clear_buffer(self, phone: str) -> Optional[Dict[str, Any]]:
        """
        Atomically get buffer and delete from Redis.

        Uses pipeline for atomic GET + DEL operation.

        Args:
            phone: User phone number

        Returns:
            Buffer dict if exists, None otherwise
        """
        key = self._get_key(phone)

        # Pipeline for atomicity (GET + DEL)
        pipe = self.redis.pipeline()
        pipe.get(key)
        pipe.delete(key)
        results = pipe.execute()

        raw_data = results[0]

        if not raw_data:
            return None

        buffer_data = json.loads(raw_data)
        logger.info(
            f"[BUFFER] Cleared buffer for {phone}. "
            f"Messages: {len(buffer_data['messages'])}"
        )
        return buffer_data

    def get_combined_message(self, buffer: Dict) -> str:
        """
        Combine buffered messages into single text.

        Uses newline separator so LLM can distinguish separate thoughts.

        Args:
            buffer: Buffer dict from get_and_clear_buffer

        Returns:
            Combined message string
        """
        messages = buffer.get("messages", [])
        # Use newline to help LLM understand these were separate messages
        combined = "\n".join(messages)
        return combined


# Global singleton instance
message_buffer_service = MessageBufferService()

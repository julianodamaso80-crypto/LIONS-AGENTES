"""
Redis client singleton module for message buffer system.
"""

import logging

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis_client = None


def get_redis_client() -> redis.Redis:
    """
    Returns singleton Redis client instance.

    Returns:
        redis.Redis: Configured Redis client

    Raises:
        Exception: If connection to Redis fails
    """
    global _redis_client

    if _redis_client is None:
        logger.info(f"[REDIS] Connecting to {settings.REDIS_URL}...")
        try:
            _redis_client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,  # Returns strings instead of bytes
                socket_timeout=5,
                retry_on_timeout=True,
            )
            # Test connection
            _redis_client.ping()
            logger.info("✅ [REDIS] Connected successfully")
        except Exception as e:
            logger.error(f"❌ [REDIS] Failed to connect: {e}")
            raise e

    return _redis_client

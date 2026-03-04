"""
Shopify Agent Authentication Service.

Generates and caches OAuth Bearer tokens for Shopify MCP authentication.

Reference: https://shopify.dev/docs/agents/get-started/authentication
"""

import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

SHOPIFY_TOKEN_URL = "https://api.shopify.com/auth/access_token"


@dataclass
class TokenCache:
    """Cache entry for OAuth token."""
    access_token: str
    expires_at: float  # Unix timestamp
    token_type: str = "Bearer"


class ShopifyAuthService:
    """
    Service for generating and caching Shopify OAuth tokens.

    Tokens are JWT-formatted and expire after a period (usually 1 hour).
    This service caches tokens and auto-refreshes when expired.
    """

    _instance: Optional["ShopifyAuthService"] = None
    _token_cache: Optional[TokenCache] = None

    def __new__(cls):
        """Singleton pattern."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def is_configured(self) -> bool:
        """Check if Shopify credentials are configured."""
        return bool(
            settings.SHOPIFY_AGENT_CLIENT_ID and
            settings.SHOPIFY_AGENT_CLIENT_SECRET
        )

    async def get_bearer_token(self, force_refresh: bool = False) -> Optional[str]:
        """
        Get a valid Bearer token for Shopify MCP authentication.

        Args:
            force_refresh: If True, generate a new token even if cached one is valid

        Returns:
            Bearer token string or None if credentials not configured
        """
        if not self.is_configured:
            logger.warning("[Shopify Auth] Credentials not configured (SHOPIFY_AGENT_CLIENT_ID, SHOPIFY_AGENT_CLIENT_SECRET)")
            return None

        # Check cache
        if not force_refresh and self._token_cache:
            # Check if token is still valid (with 60s buffer)
            if self._token_cache.expires_at > time.time() + 60:
                logger.debug("[Shopify Auth] Using cached token")
                return self._token_cache.access_token

        # Generate new token
        token = await self._generate_token()
        if token:
            return token.access_token

        return None

    async def _generate_token(self) -> Optional[TokenCache]:
        """
        Generate a new OAuth token from Shopify.

        POST https://api.shopify.com/auth/access_token
        {
            "client_id": "...",
            "client_secret": "...",
            "grant_type": "client_credentials"
        }
        """
        logger.info("[Shopify Auth] Generating new OAuth token...")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    SHOPIFY_TOKEN_URL,
                    json={
                        "client_id": settings.SHOPIFY_AGENT_CLIENT_ID,
                        "client_secret": settings.SHOPIFY_AGENT_CLIENT_SECRET,
                        "grant_type": "client_credentials"
                    },
                    headers={"Content-Type": "application/json"}
                )

                if response.status_code != 200:
                    logger.error(f"[Shopify Auth] Token request failed: {response.status_code} - {response.text}")
                    return None

                data = response.json()

                access_token = data.get("access_token")
                expires_in = data.get("expires_in", 3600)  # Default 1 hour
                token_type = data.get("token_type", "Bearer")

                if not access_token:
                    logger.error(f"[Shopify Auth] No access_token in response: {data}")
                    return None

                # Cache the token
                self._token_cache = TokenCache(
                    access_token=access_token,
                    expires_at=time.time() + expires_in,
                    token_type=token_type
                )

                logger.info(f"[Shopify Auth] ✅ Token generated successfully (expires in {expires_in}s)")
                return self._token_cache

        except Exception as e:
            logger.error(f"[Shopify Auth] Token generation failed: {e}")
            return None

    def clear_cache(self):
        """Clear the token cache."""
        self._token_cache = None
        logger.info("[Shopify Auth] Token cache cleared")


# Singleton instance
_shopify_auth_service: Optional[ShopifyAuthService] = None


def get_shopify_auth_service() -> ShopifyAuthService:
    """Get the singleton ShopifyAuthService instance."""
    global _shopify_auth_service
    if _shopify_auth_service is None:
        _shopify_auth_service = ShopifyAuthService()
    return _shopify_auth_service

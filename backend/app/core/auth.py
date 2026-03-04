"""
Authentication Dependencies for FastAPI

Provides authentication and authorization helpers for protected endpoints.
"""

import logging
import os
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, status

from .database import AsyncSupabaseClient, get_async_db

logger = logging.getLogger(__name__)


async def require_master_admin(
    x_admin_api_key: Optional[str] = Header(None, alias="X-Admin-API-Key"),
    request: Request = None
) -> bool:
    """
    Dependency that validates Master Admin access via API Key.

    Use for: ops/system endpoints (billing processing, pricing management, plans CRUD)

    Validates the request has a valid admin API key in the X-Admin-API-Key header.

    Usage:
        @router.post("/admin-only")
        async def admin_endpoint(_: bool = Depends(require_master_admin)):
            ...

    Raises:
        HTTPException 401: If API key is missing
        HTTPException 403: If API key is invalid
    """
    admin_key = os.getenv("ADMIN_API_KEY")

    if not admin_key:
        logger.error("[Auth] ADMIN_API_KEY not configured in environment")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin authentication not configured"
        )

    if not x_admin_api_key:
        logger.warning(f"[Auth] Missing X-Admin-API-Key header from {request.client.host if request else 'unknown'}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin API key required"
        )

    if x_admin_api_key != admin_key:
        logger.warning(f"[Auth] Invalid admin API key attempt from {request.client.host if request else 'unknown'}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin API key"
        )

    logger.debug("[Auth] Admin authentication successful")
    return True


async def require_authenticated_user(
    request: Request,
    user_id: Optional[str] = Cookie(None, alias="user_id"),
    db: AsyncSupabaseClient = Depends(get_async_db)
) -> str:
    """
    Dependency that validates user is logged in via session cookie.

    SECURITY: Validates user_id against database to prevent session forgery.

    Use for: frontend admin panel endpoints (send-message, update-status)

    Usage:
        @router.post("/admin-action")
        async def admin_action(user_id: str = Depends(require_authenticated_user)):
            ...

    Returns:
        str: The authenticated user's ID

    Raises:
        HTTPException 401: If user is not logged in or session is invalid
        HTTPException 403: If account is suspended
    """
    if not user_id:
        logger.warning(f"[Auth] Missing user_id cookie from {request.client.host if request else 'unknown'}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in."
        )

    # Validate user exists and is active in database
    try:
        result = await db.client.table("users_v2") \
            .select("id, status") \
            .eq("id", user_id) \
            .single() \
            .execute()

        if not result.data:
            logger.warning(f"[Auth] User {user_id} not found in database")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid session. Please log in again."
            )

        user_status = result.data.get("status")
        if user_status == "suspended":
            logger.warning(f"[Auth] User {user_id} is suspended")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account suspended. Contact support."
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Auth] Database validation failed for user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication check failed"
        ) from e

    logger.debug(f"[Auth] User {user_id} authenticated and validated")
    return user_id


async def get_current_company_id(
    user_id: str = Depends(require_authenticated_user),
    db: AsyncSupabaseClient = Depends(get_async_db)
) -> str:
    """
    Dependency that returns the company_id of the authenticated user.

    SECURITY: Chains with require_authenticated_user to ensure user is valid,
    then looks up their company_id from the database.

    Use for: billing, checkout, and other endpoints that need company context.

    Usage:
        @router.get("/my-subscription")
        async def get_subscription(company_id: str = Depends(get_current_company_id)):
            ...

    Returns:
        str: The authenticated user's company_id

    Raises:
        HTTPException 401: If user is not authenticated (from require_authenticated_user)
        HTTPException 400: If user is not associated with a company
    """
    try:
        result = await db.client.table("users_v2") \
            .select("company_id") \
            .eq("id", user_id) \
            .single() \
            .execute()

        if not result.data:
            logger.warning(f"[Auth] User {user_id} not found when getting company_id")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid session."
            )

        company_id = result.data.get("company_id")
        if not company_id:
            logger.warning(f"[Auth] User {user_id} has no company_id")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not associated with a company."
            )

        logger.debug(f"[Auth] User {user_id} belongs to company {company_id}")
        return company_id

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Auth] Error getting company_id for user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not verify user company."
        ) from e

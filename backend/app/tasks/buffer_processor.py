"""
Buffer Processor - Periodic task to check and process WhatsApp message buffers.

Runs every 1 second to check for buffers that are ready to be processed
(either debounce timeout or max wait reached).
"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.redis import get_redis_client
from app.services.message_buffer_service import message_buffer_service

logger = logging.getLogger(__name__)

# Silence APScheduler verbose logs (only show WARNING and ERROR)
logging.getLogger("apscheduler").setLevel(logging.WARNING)
logging.getLogger("apscheduler.scheduler").setLevel(logging.WARNING)
logging.getLogger("apscheduler.executors").setLevel(logging.WARNING)
logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)

# Global scheduler instance
scheduler = AsyncIOScheduler()


async def check_buffers():
    """
    Periodic job that scans Redis for active buffers and processes ready ones.

    Runs every 1 second. For each buffer that meets processing criteria
    (debounce or max wait), atomically retrieves and clears it, then
    dispatches for LLM processing.

    Only logs when actually processing buffers (not on empty scans).
    """
    redis = get_redis_client()

    # Import here to avoid circular dependency
    from app.api.webhook import process_whatsapp_message_background

    try:
        # Scan for all buffer keys (cursor-based for performance)
        cursor = 0
        processed_count = 0

        while True:
            cursor, keys = redis.scan(
                cursor=cursor, match="whatsapp_buffer:*", count=100
            )

            for key in keys:
                # Extract phone number from key
                phone = key.split(":")[-1]

                # Check if should process (non-destructive check)
                if message_buffer_service.should_process(phone):
                    # Atomically get and clear buffer
                    buffer = message_buffer_service.get_and_clear_buffer(phone)

                    if buffer:
                        # Combine messages
                        combined_msg = message_buffer_service.get_combined_message(
                            buffer
                        )
                        msg_count = len(buffer["messages"])

                        # Log processing (only when actually processing!)
                        logger.info(
                            f"[BUFFER] Processing buffer for {phone}: {msg_count} messages"
                        )

                        # Call background processing function
                        await process_whatsapp_message_background(
                            payload_dict=buffer["payload"],
                            combined_message=combined_msg,
                        )

                        logger.info(
                            f"[BUFFER] ✅ Processed {phone}: combined {msg_count} msgs"
                        )
                        processed_count += 1

            # Continue scan if not at end
            if cursor == 0:
                break

        # No logging if nothing processed (reduces spam)

    except Exception as e:
        # Only log errors
        logger.error(f"[BUFFER] ❌ Error in check_buffers: {e}", exc_info=True)


def start_buffer_scheduler():
    """Start the APScheduler for buffer processing."""
    if not scheduler.running:
        # Add job: check buffers every 1 second
        # max_instances=10 allows parallel processing under high load
        scheduler.add_job(
            check_buffers,
            "interval",
            seconds=1,
            id="whatsapp_buffer_check",
            max_instances=10,  # Allow parallel runs under load (was 1)
        )
        scheduler.start()
        logger.info("✅ [BUFFER SCHEDULER] Started (interval: 1s, max_instances: 10)")
    else:
        logger.warning("[BUFFER SCHEDULER] Already running")


def shutdown_buffer_scheduler():
    """Shutdown the APScheduler gracefully."""
    if scheduler.running:
        scheduler.shutdown(wait=True)
        logger.info("🛑 [BUFFER SCHEDULER] Stopped")
    else:
        logger.warning("[BUFFER SCHEDULER] Not running")

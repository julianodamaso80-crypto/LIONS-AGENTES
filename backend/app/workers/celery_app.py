"""
Celery Application Configuration

Configures Celery with Redis broker for background billing tasks.
"""

import os

from celery import Celery

# Get Redis URL from environment
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
BILLING_INTERVAL_MINUTES = int(os.getenv("BILLING_INTERVAL_MINUTES", "5"))

# Create Celery app
celery_app = Celery(
    "smith_billing",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.workers.billing_tasks",
        "app.workers.sanitization_tasks",
    ]
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Task execution settings
    task_acks_late=True,  # Acknowledge after task completes (more reliable)
    task_reject_on_worker_lost=True,

    # Retry settings
    task_default_retry_delay=60,  # 1 minute
    task_max_retries=3,

    # Worker settings
    worker_prefetch_multiplier=1,  # One task at a time for billing
    worker_concurrency=2,  # 2 concurrent workers

    # Result backend settings
    result_expires=3600,  # Results expire after 1 hour

    # Beat schedule (periodic tasks)
    beat_schedule={
        "process-unbilled-usage-every-5-minutes": {
            "task": "app.workers.billing_tasks.process_unbilled_usage",
            "schedule": BILLING_INTERVAL_MINUTES * 60,  # Convert to seconds
            "options": {"queue": "billing"}
        },
        "cleanup-expired-sanitization-jobs-daily": {
            "task": "app.workers.sanitization_tasks.cleanup_expired_sanitization_jobs",
            "schedule": 86400,  # 24 hours in seconds
            "options": {"queue": "sanitization"}
        },
    },

    # Task routing
    task_routes={
        "app.workers.billing_tasks.*": {"queue": "billing"},
        "app.workers.sanitization_tasks.*": {"queue": "sanitization"},
    },
)

# Optional: Configure task annotations for specific tasks
celery_app.conf.task_annotations = {
    "app.workers.billing_tasks.process_unbilled_usage": {
        "rate_limit": "1/m"  # Max 1 execution per minute
    }
}

"""
Rate Limiting Configuration
Usando slowapi para proteger endpoints críticos contra abuso.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

# Limiter global - usa IP como chave de identificação
limiter = Limiter(key_func=get_remote_address)

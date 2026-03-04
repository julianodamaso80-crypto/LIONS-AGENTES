
import logging
from typing import Tuple

from presidio_analyzer import (
    AnalyzerEngine,
    Pattern,
    PatternRecognizer,
)
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

logger = logging.getLogger(__name__)


# =============================================================================
# CUSTOM BRAZILIAN RECOGNIZERS
# =============================================================================

class BrazilianCPFRecognizer(PatternRecognizer):
    """Recognizer for Brazilian CPF (Cadastro de Pessoa Física)."""

    PATTERNS = [
        Pattern(
            "CPF (XXX.XXX.XXX-XX)",
            r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b",
            0.85
        ),
        Pattern(
            "CPF (XXXXXXXXXXX)",
            r"\b\d{11}\b",
            0.4  # Lower score, needs validation
        ),
    ]

    CONTEXT = ["cpf", "cadastro", "pessoa física", "documento"]

    def __init__(self):
        super().__init__(
            supported_entity="BR_CPF",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="pt",
        )


class BrazilianCNPJRecognizer(PatternRecognizer):
    """Recognizer for Brazilian CNPJ (Cadastro Nacional de Pessoa Jurídica)."""

    PATTERNS = [
        Pattern(
            "CNPJ (XX.XXX.XXX/XXXX-XX)",
            r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b",
            0.85
        ),
    ]

    CONTEXT = ["cnpj", "empresa", "pessoa jurídica", "razão social"]

    def __init__(self):
        super().__init__(
            supported_entity="BR_CNPJ",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="pt",
        )


class BrazilianPhoneRecognizer(PatternRecognizer):
    """Recognizer for Brazilian phone numbers."""

    PATTERNS = [
        Pattern(
            "BR Phone (+55 XX XXXXX-XXXX)",
            r"\+55\s?\d{2}\s?\d{4,5}[-\s]?\d{4}\b",
            0.85
        ),
        Pattern(
            "BR Phone (XX XXXXX-XXXX)",
            r"\b\d{2}\s?\d{4,5}[-\s]?\d{4}\b",
            0.6
        ),
        Pattern(
            "BR Phone ((XX) XXXXX-XXXX)",
            r"\(\d{2}\)\s?\d{4,5}[-\s]?\d{4}\b",
            0.85
        ),
    ]

    CONTEXT = ["telefone", "celular", "whatsapp", "ligar", "contato", "fone"]

    def __init__(self):
        super().__init__(
            supported_entity="BR_PHONE",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="pt",
        )


class BrazilianEmailRecognizer(PatternRecognizer):
    """Email recognizer with Portuguese context."""

    PATTERNS = [
        Pattern(
            "Email",
            r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
            0.9
        ),
    ]

    CONTEXT = ["email", "e-mail", "correio", "enviar"]

    def __init__(self):
        super().__init__(
            supported_entity="EMAIL_ADDRESS",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="pt",
        )


# =============================================================================
# PRESIDIO SERVICE
# =============================================================================

class PresidioService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(PresidioService, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        try:
            # Try to load Portuguese model, fallback to multilingual approach
            try:
                configuration = {
                    "nlp_engine_name": "spacy",
                    "models": [
                        {"lang_code": "pt", "model_name": "pt_core_news_md"},
                        {"lang_code": "en", "model_name": "en_core_web_lg"},
                    ],
                }
                provider = NlpEngineProvider(nlp_configuration=configuration)
                nlp_engine = provider.create_engine()

                self.analyzer = AnalyzerEngine(
                    nlp_engine=nlp_engine,
                    supported_languages=["pt", "en"]
                )
                logger.info("Presidio Service initialized with Portuguese (pt_core_news_md) + English")

            except Exception as model_error:
                logger.warning(f"Could not load pt_core_news_md: {model_error}. Using default engine.")
                self.analyzer = AnalyzerEngine()

            # Register Brazilian recognizers
            self.analyzer.registry.add_recognizer(BrazilianCPFRecognizer())
            self.analyzer.registry.add_recognizer(BrazilianCNPJRecognizer())
            self.analyzer.registry.add_recognizer(BrazilianPhoneRecognizer())
            self.analyzer.registry.add_recognizer(BrazilianEmailRecognizer())

            self.anonymizer = AnonymizerEngine()
            logger.info("Presidio Service initialized with Brazilian recognizers (CPF, CNPJ, Phone, Email)")
            self.initialized = True

        except Exception as e:
            logger.error(f"Failed to initialize Presidio: {e}")
            self.initialized = False

    def analyze_and_anonymize(self, text: str, action: str = 'mask') -> Tuple[bool, str]:
        """
        Analisa texto buscando PII e aplica ação (mask ou block).
        Retorna (found_pii: bool, processed_text: str)
        """
        if not self.initialized or not text:
            return False, text

        try:
            # 1. Analyze with Portuguese language
            results = self.analyzer.analyze(text=text, language='pt')

            if not results:
                return False, text

            # Log what was found for debugging
            entities_found = [f"{r.entity_type}:{r.score:.2f}" for r in results]
            logger.info(f"[Presidio] PII detected: {entities_found}")

            # 2. Se ação for BLOCK, retorna flag true e texto original
            if action == 'block':
                return True, text

            # 3. Se ação for MASK, anonimiza
            if action == 'mask':
                anonymized_result = self.anonymizer.anonymize(
                    text=text,
                    analyzer_results=results,
                    operators={
                        "DEFAULT": OperatorConfig("replace", {"new_value": "****"}),
                        "BR_CPF": OperatorConfig("replace", {"new_value": "[CPF OCULTO]"}),
                        "BR_CNPJ": OperatorConfig("replace", {"new_value": "[CNPJ OCULTO]"}),
                        "BR_PHONE": OperatorConfig("replace", {"new_value": "[TELEFONE OCULTO]"}),
                        "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL OCULTO]"}),
                    }
                )
                return True, anonymized_result.text

            return False, text

        except Exception as e:
            logger.error(f"Error in PII analysis: {e}")
            return False, text


def get_presidio_service():
    return PresidioService()

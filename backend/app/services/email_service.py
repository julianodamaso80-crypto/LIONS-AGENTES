"""
Email Service - Envio de emails via SendGrid

Usado para:
- Alertas de consumo (80%, 100%)
- Notificações de pagamento
"""

import logging
from datetime import datetime
from typing import Optional

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from ..core.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    """Serviço para envio de emails via SendGrid."""

    def __init__(self):
        self.api_key = settings.SENDGRID_API_KEY
        self.from_email = settings.SENDGRID_FROM_EMAIL
        self.configured = bool(self.api_key and self.from_email)

        if not self.configured:
            logger.warning("[Email] SendGrid not configured. Email sending disabled.")

    def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        plain_text: Optional[str] = None
    ) -> bool:
        """Envia email via SendGrid."""
        if not self.configured:
            logger.warning(f"[Email] SendGrid not configured. Skipping email to {to_email}")
            return False

        try:
            message = Mail(
                from_email=self.from_email,
                to_emails=to_email,
                subject=subject,
                html_content=html_content
            )

            if plain_text:
                message.plain_text_content = plain_text

            sg = SendGridAPIClient(self.api_key)
            response = sg.send(message)

            logger.info(f"[Email] ✅ Sent to {to_email}: {subject} (status={response.status_code})")
            return True

        except Exception as e:
            logger.error(f"[Email] ❌ Failed to send email to {to_email}: {e}")
            return False

    def send_consumption_alert_80(self, to_email: str, company_name: str, balance_percentage: float, plan_name: str) -> bool:
        """Envia alerta de consumo 80%."""
        subject = f"⚠️ Alerta: 80% dos créditos utilizados - {company_name}"

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #0D0D0D;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0D0D0D; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0" style="background-color: #1A1A1A; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3); border: 1px solid #2D2D2D;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">⚠️ Alerta de Consumo</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #E5E5E5; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Olá,
              </p>

              <p style="color: #E5E5E5; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Você já utilizou <strong style="color: #F59E0B;">80%</strong> dos créditos do plano
                <strong>{plan_name}</strong> da empresa <strong>{company_name}</strong>.
              </p>

              <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0;">
                Restam apenas <strong>{balance_percentage:.1f}%</strong> dos seus créditos.
                Considere fazer upgrade do seu plano para evitar interrupções no serviço.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="{settings.FRONTEND_URL}/admin/billing"
                       style="background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%);
                              color: #ffffff;
                              text-decoration: none;
                              padding: 16px 40px;
                              border-radius: 6px;
                              font-size: 16px;
                              font-weight: bold;
                              display: inline-block;">
                      Gerenciar Plano
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #141414; padding: 25px; text-align: center; border-top: 1px solid #2D2D2D;">
              <p style="color: #4B5563; font-size: 11px; margin: 0;">
                © {datetime.now().year} Smith AI - Sistema de Atendimento Inteligente
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        """.strip()

        return self.send_email(to_email, subject, html_content)

    def send_consumption_alert_100(self, to_email: str, company_name: str, plan_name: str) -> bool:
        """Envia alerta de consumo 100% - serviço interrompido."""
        subject = f"🚨 Créditos Esgotados - {company_name}"

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #0D0D0D;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0D0D0D; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0" style="background-color: #1A1A1A; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3); border: 1px solid #2D2D2D;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #EF4444 0%, #B91C1C 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">🚨 Créditos Esgotados</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #E5E5E5; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Olá,
              </p>

              <p style="color: #E5E5E5; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Os créditos do plano <strong>{plan_name}</strong> da empresa <strong>{company_name}</strong> foram
                <strong style="color: #EF4444;">esgotados</strong>.
              </p>

              <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0;">
                O serviço de atendimento via agentes de IA foi <strong>temporariamente interrompido</strong>.
                Para restabelecer o serviço, renove seu plano ou faça upgrade.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="{settings.FRONTEND_URL}/admin/billing"
                       style="background: linear-gradient(135deg, #10B981 0%, #047857 100%);
                              color: #ffffff;
                              text-decoration: none;
                              padding: 16px 40px;
                              border-radius: 6px;
                              font-size: 16px;
                              font-weight: bold;
                              display: inline-block;">
                      Renovar Agora
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #141414; padding: 25px; text-align: center; border-top: 1px solid #2D2D2D;">
              <p style="color: #4B5563; font-size: 11px; margin: 0;">
                © {datetime.now().year} Smith AI - Sistema de Atendimento Inteligente
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        """.strip()

        return self.send_email(to_email, subject, html_content)


# Singleton
_email_service: Optional[EmailService] = None


def get_email_service() -> EmailService:
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service

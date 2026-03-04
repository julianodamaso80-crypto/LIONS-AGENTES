import sgMail from '@sendgrid/mail';

// Initialize SendGrid with API key
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('[EMAIL] SendGrid API key not configured. Email sending will be disabled.');
}

export interface SendInviteEmailParams {
  to: string;
  name?: string;
  inviteLink: string;
  role: 'admin_company' | 'member';
  companyName: string;
}

/**
 * Send invite email to a user
 */
export async function sendInviteEmail(
  params: SendInviteEmailParams,
): Promise<{ success: boolean; error?: string }> {
  const { to, name, inviteLink, role, companyName } = params;

  // Check if SendGrid is configured
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.error('[EMAIL] SendGrid not configured. Skipping email send.');
    return {
      success: false,
      error: 'Email service not configured',
    };
  }

  const roleText = role === 'admin_company' ? 'Administrador' : 'Membro';
  const greeting = name ? `Olá ${name.split(' ')[0]},` : 'Olá,';

  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: `Convite para participar da ${companyName}`,
    text: `
${greeting}

Você foi convidado para ser ${roleText} na empresa ${companyName}.

Para aceitar o convite e criar sua conta, acesse o link abaixo:
${inviteLink}

Este convite é exclusivo para você e expira em 7 dias.

Equipe Smith
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Convite para ${companyName}</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${greeting}
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Você foi convidado para ser <strong>${roleText}</strong> na empresa <strong>${companyName}</strong>.
              </p>

              <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0;">
                Para aceitar o convite e criar sua conta, clique no botão abaixo:
              </p>

              <!-- Call to Action Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${inviteLink}"
                       style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                              color: #ffffff;
                              text-decoration: none;
                              padding: 16px 40px;
                              border-radius: 6px;
                              font-size: 16px;
                              font-weight: bold;
                              display: inline-block;">
                      Aceitar Convite
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #999999; font-size: 13px; line-height: 1.6; margin: 20px 0 0 0; text-align: center;">
                Ou copie e cole este link no seu navegador:<br>
                <a href="${inviteLink}" style="color: #667eea; word-break: break-all;">${inviteLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0 0 10px 0;">
                Este convite é exclusivo para <strong>${to}</strong> e expira em 7 dias.
              </p>
              <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
                Se você não esperava este convite, pode ignorar este email.
              </p>
              <p style="color: #cccccc; font-size: 11px; margin: 20px 0 0 0;">
                © ${new Date().getFullYear()} Smith AI - Sistema de Atendimento Inteligente
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };

  try {
    console.log('[EMAIL] Sending invite email to:', to);
    await sgMail.send(msg);
    console.log('[EMAIL] Email sent successfully to:', to);
    return { success: true };
  } catch (error: any) {
    console.error('[EMAIL] Failed to send email:', {
      to,
      error: error.message,
      response: error.response?.body,
    });
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Send password recovery email with OTP code
 */
export async function sendRecoveryEmail(
  email: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  // Check if SendGrid is configured
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.error('[EMAIL] SendGrid not configured. Skipping recovery email send.');
    return {
      success: false,
      error: 'Email service not configured',
    };
  }

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: 'Recuperação de Senha - Smith',
    text: `
Olá,

Você solicitou a recuperação de sua senha no Smith.

Seu código de verificação é: ${code}

Este código expira em 15 minutos.

Se você não solicitou esta recuperação, ignore este email.

Equipe Smith
        `.trim(),
    html: `
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
            <td style="background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">🔐 Recuperação de Senha</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #E5E5E5; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0; text-align: center;">
                Você solicitou a recuperação de sua senha.
              </p>

              <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0; text-align: center;">
                Use o código abaixo para criar uma nova senha:
              </p>

              <!-- OTP Code Box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <div style="background: linear-gradient(135deg, #1E3A5F 0%, #1E40AF 100%);
                                border: 2px solid #3B82F6;
                                border-radius: 12px;
                                padding: 25px 50px;
                                display: inline-block;">
                      <span style="color: #FFFFFF;
                                   font-size: 36px;
                                   font-weight: bold;
                                   letter-spacing: 12px;
                                   font-family: 'Courier New', monospace;">
                        ${code}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="color: #EF4444; font-size: 13px; line-height: 1.6; margin: 30px 0 0 0; text-align: center;">
                ⏱️ Este código expira em <strong>15 minutos</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #141414; padding: 25px; text-align: center; border-top: 1px solid #2D2D2D;">
              <p style="color: #6B7280; font-size: 12px; line-height: 1.6; margin: 0 0 10px 0;">
                Se você não solicitou esta recuperação, ignore este email.
              </p>
              <p style="color: #4B5563; font-size: 11px; margin: 15px 0 0 0;">
                © ${new Date().getFullYear()} Smith AI - Sistema de Atendimento Inteligente
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `.trim(),
  };

  try {
    console.log('[EMAIL] Sending recovery email to:', email);
    await sgMail.send(msg);
    console.log('[EMAIL] Recovery email sent successfully to:', email);
    return { success: true };
  } catch (error: any) {
    console.error('[EMAIL] Failed to send recovery email:', {
      to: email,
      error: error.message,
      response: error.response?.body,
    });
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

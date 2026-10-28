/**
 * Email Configuration using Nodemailer
 */

const nodemailer = require('nodemailer');

// Debug: Log SMTP config (remove in production)
console.log('📧 SMTP Config:', {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  user: process.env.SMTP_USER ? '✅ Set' : '❌ Missing',
  pass: process.env.SMTP_PASSWORD ? '✅ Set' : '❌ Missing'
});

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

/**
 * Send Password Reset Email
 */
const sendPasswordResetEmail = async (to, resetLink, userName) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || '"ClaimsMitra" <noreply@claimsmitra.com>',
    to: to,
    subject: 'Reset Your Password - ClaimsMitra',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">ClaimsMitra</h1>
                    <p style="color: #e0e0e0; margin: 10px 0 0 0; font-size: 14px;">Survey Management Platform</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: #333; margin: 0 0 20px 0; font-size: 22px;">Password Reset Request</h2>
                    
                    <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Hello${userName ? ' ' + userName : ''},
                    </p>
                    
                    <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      We received a request to reset your password for your ClaimsMitra account. 
                      Click the button below to create a new password:
                    </p>
                    
                    <!-- Button -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding: 20px 0;">
                          <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 50px; font-size: 16px; font-weight: bold; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                            Reset Password
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="color: #888; font-size: 14px; line-height: 1.6; margin: 20px 0;">
                      This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, 
                      please ignore this email or contact support if you have concerns.
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                    
                    <p style="color: #888; font-size: 12px; margin: 0;">
                      If the button doesn't work, copy and paste this link into your browser:
                    </p>
                    <p style="color: #667eea; font-size: 12px; word-break: break-all; margin: 10px 0 0 0;">
                      ${resetLink}
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-radius: 0 0 10px 10px;">
                    <p style="color: #888; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} ClaimsMitra. All rights reserved.
                    </p>
                    <p style="color: #aaa; font-size: 11px; margin: 10px 0 0 0;">
                      This is an automated message. Please do not reply to this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `
  };

  return transporter.sendMail(mailOptions);
};

/**
 * Verify SMTP connection
 */
const verifyConnection = async () => {
  try {
    await transporter.verify();
    console.log('✅ SMTP connection verified');
    return true;
  } catch (error) {
    console.error('❌ SMTP connection failed:', error.message);
    return false;
  }
};

module.exports = {
  transporter,
  sendPasswordResetEmail,
  verifyConnection
};

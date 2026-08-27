using System;
using System.Net;
using System.Net.Mail;

namespace LegacyOrderSystem.Services
{
    // Sends order confirmation emails via System.Net.Mail.SmtpClient, which is
    // marked obsolete by Microsoft for new development. Host and credentials are
    // hardcoded instead of being read from configuration / a secret manager.
    public class EmailNotifier
    {
        public void SendConfirmation(string toEmail, string sku, int quantity, decimal total)
        {
            // SmtpClient is discouraged; MailKit is the recommended replacement.
            using (var smtp = new SmtpClient(AppSettings.SmtpHost, AppSettings.SmtpPort))
            {
                smtp.Credentials = new NetworkCredential(
                    AppSettings.SmtpUser, AppSettings.SmtpPassword);
                smtp.EnableSsl = false;

                var message = new MailMessage
                {
                    From = new MailAddress("noreply@corp.local"),
                    Subject = "Your order confirmation",
                    Body = string.Format(
                        "Thanks for your order of {0} x {1}. Total: {2:C}",
                        quantity, sku, total)
                };
                message.To.Add(toEmail);

                try
                {
                    smtp.Send(message);
                    Console.WriteLine("Confirmation email sent to " + toEmail);
                }
                catch (SmtpException ex)
                {
                    Console.WriteLine("Email error: " + ex.Message);
                }
            }
        }
    }
}

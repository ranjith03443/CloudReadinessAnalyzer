using System;
using System.IO;
using System.Net;
using System.Text;

namespace LegacyOrderSystem.Services
{
    // Calls an external payment API using the obsolete WebClient and a
    // synchronous, blocking request. The API key is pulled from a hardcoded
    // constant rather than configuration / a secret store.
    public class PaymentGateway
    {
        public bool Charge(string customerEmail, decimal amount)
        {
            try
            {
                // WebClient is legacy; HttpClient is the modern replacement.
                using (var client = new WebClient())
                {
                    client.Headers.Add("Authorization", "Bearer " + AppSettings.PaymentApiKey);
                    client.Headers.Add("Content-Type", "application/x-www-form-urlencoded");

                    string body = "email=" + customerEmail + "&amount=" + amount;

                    // ServicePointManager security protocol set globally — a
                    // legacy pattern that pins TLS at the process level.
                    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

                    byte[] response = client.UploadData(
                        "https://api.legacy-payments.com/v1/charge",
                        "POST",
                        Encoding.UTF8.GetBytes(body));

                    string result = Encoding.UTF8.GetString(response);
                    return result.Contains("\"status\":\"ok\"");
                }
            }
            catch (WebException ex)
            {
                Console.WriteLine("Payment error: " + ex.Message);
                return false;
            }
        }
    }
}

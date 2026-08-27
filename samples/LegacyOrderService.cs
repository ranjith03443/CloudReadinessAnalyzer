using System;
using System.Collections;
using System.Configuration;
using System.Data.SqlClient;
using System.IO;
using System.Net;
using System.Web;

namespace Contoso.Orders
{
    // Legacy ASP.NET (.NET Framework 4.5) order service.
    public class LegacyOrderService
    {
        // Hardcoded connection string with embedded credentials.
        private const string ConnectionString =
            "Server=PROD-SQL01;Database=Orders;User Id=sa;Password=P@ssw0rd123;";

        // Hardcoded local file path for logging.
        private const string LogPath = @"C:\inetpub\logs\orders\order-service.log";

        public Hashtable GetOrder(int orderId)
        {
            // ArrayList / Hashtable are non-generic legacy collections.
            Hashtable result = new Hashtable();

            using (SqlConnection conn = new SqlConnection(ConnectionString))
            {
                conn.Open();
                SqlCommand cmd = new SqlCommand(
                    "SELECT * FROM Orders WHERE Id = " + orderId, conn); // string concatenation -> SQL injection
                SqlDataReader reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    result["id"] = reader["Id"];
                    result["customer"] = reader["Customer"];
                    result["total"] = reader["Total"];
                }
            }

            // Storing per-user state in in-process Session (breaks on multi-instance / scale-out).
            HttpContext.Current.Session["lastOrderId"] = orderId;

            Log("Fetched order " + orderId);
            return result;
        }

        public string CallPaymentGateway(string payload)
        {
            // Obsolete WebClient + hardcoded absolute endpoint.
            WebClient client = new WebClient();
            string endpoint = "http://payments.internal.contoso.com/api/charge";
            return client.UploadString(endpoint, payload);
        }

        private void Log(string message)
        {
            // Writes to a fixed local path that won't exist on a cloud host.
            File.AppendAllText(LogPath, DateTime.Now + " " + message + Environment.NewLine);
        }

        public string GetSetting()
        {
            // Reads from web.config <appSettings>, tightly coupled to the file.
            return ConfigurationManager.AppSettings["ApiTimeout"];
        }
    }
}

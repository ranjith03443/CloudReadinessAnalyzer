using System;

namespace LegacyOrderSystem
{
    // Centralized settings — but everything is hardcoded into the binary,
    // which breaks the 12-factor "config in the environment" principle and
    // makes the app impossible to reconfigure per environment without a rebuild.
    public static class AppSettings
    {
        // Hardcoded connection string with embedded credentials.
        public const string ConnectionString =
            "Server=PROD-SQL-01;Database=Orders;User Id=sa;Password=P@ssw0rd123;";

        // Hardcoded third-party API key.
        public const string PaymentApiKey = "sk_live_51H8xMjK2eZvKYlo9qZ";

        // Hardcoded SMTP server and credentials.
        public const string SmtpHost = "smtp.internal.corp.local";
        public const int SmtpPort = 25;
        public const string SmtpUser = "noreply@corp.local";
        public const string SmtpPassword = "MailP@ss2019";

        // Local Windows file path — will not exist on a Linux container / cloud host.
        public const string LogFolder = @"C:\Logs\OrderSystem\";

        // Hardcoded absolute URL to an on-prem service.
        public const string InventoryServiceUrl = "http://inventory-server-01/api/stock";
    }
}

using System;
using System.Configuration;

namespace LegacyOrderSystem
{
    // Console entry point for the legacy order processor.
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Legacy Order System starting...");

            // Hardcoded environment switch — should come from configuration.
            bool isProduction = false;

            var repo = new Data.CustomerRepository();
            var payment = new Services.PaymentGateway();
            var email = new Services.EmailNotifier();
            var orders = new Services.OrderService(repo, payment, email);

            // Reads a setting straight from app.config via ConfigurationManager.
            string defaultCustomer = ConfigurationManager.AppSettings["DefaultCustomerId"];

            orders.PlaceOrder(defaultCustomer ?? "C-1001", "SKU-42", 3);

            Console.WriteLine("Done. Press any key to exit.");
            Console.ReadKey();
        }
    }
}
